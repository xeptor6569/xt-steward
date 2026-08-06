import {
  agentDefinitions,
  nodes,
  runEvents,
  runs,
  workspaces,
  type RunEventRow,
} from "@steward/database";
import { parsePublishedRunEvent } from "@steward/protocol/internal";
import { AppError, isTerminalRunStatus, RUN_STATUSES } from "@steward/shared";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../context.js";
import {
  agentDtoSchema,
  errorResponseSchema,
  nodeDtoSchema,
  runDtoSchema,
  runEventDtoSchema,
  toAgentDto,
  toNodeDto,
  toRunDto,
  toRunEventDto,
  toWorkspaceDto,
  workspaceDtoSchema,
} from "../lib/dtos.js";
import { cancelRun, createRun } from "../lib/runs.js";
import { requireCsrf, requireUser } from "../plugins/auth.js";

const SSE_PING_INTERVAL_MS = 15_000;

export function registerRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/runs",
    {
      schema: {
        tags: ["runs"],
        summary: "List runs, newest first",
        querystring: z.object({
          status: z.enum(RUN_STATUSES).optional(),
          nodeId: z.string().optional(),
          workspaceId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: { 200: z.object({ runs: z.array(runDtoSchema) }) },
      },
      preHandler: [requireUser(ctx)],
    },
    async (request) => {
      const conditions = [];
      if (request.query.status) conditions.push(eq(runs.status, request.query.status));
      if (request.query.nodeId) conditions.push(eq(runs.nodeId, request.query.nodeId));
      if (request.query.workspaceId)
        conditions.push(eq(runs.workspaceId, request.query.workspaceId));

      const rows = await ctx.db
        .select({ run: runs, workspaceName: workspaces.name, nodeName: nodes.name })
        .from(runs)
        .leftJoin(workspaces, eq(runs.workspaceId, workspaces.id))
        .leftJoin(nodes, eq(runs.nodeId, nodes.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(runs.createdAt))
        .limit(request.query.limit)
        .offset(request.query.offset);

      return {
        runs: rows.map(({ run, workspaceName, nodeName }) =>
          toRunDto(run, { workspaceName, nodeName }),
        ),
      };
    },
  );

  r.post(
    "/runs",
    {
      schema: {
        tags: ["runs"],
        summary: "Create a diagnostic run for a workspace",
        description:
          "The browser chooses a previously registered workspace by ID. It can " +
          "never submit commands or filesystem paths; the node resolves the " +
          "workspace key against its own local configuration.",
        body: z.object({
          workspaceId: z.string().min(1),
          type: z.literal("diagnostic").default("diagnostic"),
          task: z.string().max(8192).nullish(),
        }),
        response: {
          201: z.object({ run: runDtoSchema }),
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
      preHandler: [requireCsrf(ctx), requireUser(ctx)],
    },
    async (request, reply) => {
      const run = await createRun(ctx, {
        workspaceId: request.body.workspaceId,
        type: request.body.type,
        task: request.body.task ?? null,
        requestedByUserId: request.user!.id,
      });
      return reply.status(201).send({ run: toRunDto(run) });
    },
  );

  r.get(
    "/runs/:id",
    {
      schema: {
        tags: ["runs"],
        summary: "Run details with node, workspace, and agent",
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({
            run: runDtoSchema,
            node: nodeDtoSchema.nullable(),
            workspace: workspaceDtoSchema.nullable(),
            agent: agentDtoSchema.nullable(),
          }),
          404: errorResponseSchema,
        },
      },
      preHandler: [requireUser(ctx)],
    },
    async (request) => {
      const [row] = await ctx.db
        .select({ run: runs, node: nodes, workspace: workspaces, agent: agentDefinitions })
        .from(runs)
        .leftJoin(nodes, eq(runs.nodeId, nodes.id))
        .leftJoin(workspaces, eq(runs.workspaceId, workspaces.id))
        .leftJoin(agentDefinitions, eq(runs.agentDefinitionId, agentDefinitions.id))
        .where(eq(runs.id, request.params.id))
        .limit(1);
      if (!row) throw AppError.notFound("Run");
      return {
        run: toRunDto(row.run, {
          workspaceName: row.workspace?.name ?? null,
          nodeName: row.node?.name ?? null,
        }),
        node: row.node ? toNodeDto(row.node) : null,
        workspace: row.workspace
          ? toWorkspaceDto(
              row.workspace,
              row.node ? { name: row.node.name, status: row.node.status } : null,
            )
          : null,
        agent: row.agent ? toAgentDto(row.agent) : null,
      };
    },
  );

  r.post(
    "/runs/:id/cancel",
    {
      schema: {
        tags: ["runs"],
        summary: "Request cancellation of a run (idempotent)",
        params: z.object({ id: z.string() }),
        response: {
          202: z.object({ run: runDtoSchema, alreadyTerminal: z.boolean() }),
          404: errorResponseSchema,
        },
      },
      preHandler: [requireCsrf(ctx), requireUser(ctx)],
    },
    async (request, reply) => {
      const result = await cancelRun(ctx, request.params.id, request.user!.id);
      return reply
        .status(202)
        .send({ run: toRunDto(result.run), alreadyTerminal: result.alreadyTerminal });
    },
  );

  r.get(
    "/runs/:id/events",
    {
      schema: {
        tags: ["runs"],
        summary: "Persisted run events (paginated)",
        params: z.object({ id: z.string() }),
        querystring: z.object({
          afterSequence: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(1000).default(500),
        }),
        response: {
          200: z.object({ events: z.array(runEventDtoSchema), lastSequence: z.number().int() }),
          404: errorResponseSchema,
        },
      },
      preHandler: [requireUser(ctx)],
    },
    async (request) => {
      const [run] = await ctx.db
        .select({ id: runs.id })
        .from(runs)
        .where(eq(runs.id, request.params.id))
        .limit(1);
      if (!run) throw AppError.notFound("Run");

      const rows = await ctx.db
        .select()
        .from(runEvents)
        .where(
          and(
            eq(runEvents.runId, request.params.id),
            gt(runEvents.sequence, request.query.afterSequence),
          ),
        )
        .orderBy(asc(runEvents.sequence))
        .limit(request.query.limit);
      return {
        events: rows.map(toRunEventDto),
        lastSequence: rows.at(-1)?.sequence ?? request.query.afterSequence,
      };
    },
  );

  // Server-Sent Events live stream. Documented in the OpenAPI description but
  // implemented on the raw socket (hijacked reply), so no response schema.
  r.get(
    "/runs/:id/events/stream",
    {
      schema: {
        tags: ["runs"],
        summary: "Live run event stream (Server-Sent Events)",
        description:
          "text/event-stream. Supports resume via the Last-Event-ID header or " +
          "?lastEventId= query parameter (both carry the last received event " +
          "sequence). Emits `log`, `notice`, and `state` events plus a final " +
          "`stream.end` event once the run is terminal.",
        params: z.object({ id: z.string() }),
        querystring: z.object({ lastEventId: z.coerce.number().int().min(0).optional() }),
      },
      preHandler: [requireUser(ctx)],
    },
    async (request, reply) => handleRunEventStream(ctx, request, reply),
  );
}

async function handleRunEventStream(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id: runId } = request.params as { id: string };
  const query = request.query as { lastEventId?: number };
  const [run] = await ctx.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw AppError.notFound("Run");

  const headerCursor = Number(request.headers["last-event-id"]);
  const cursor = Number.isFinite(headerCursor) ? headerCursor : (query.lastEventId ?? 0);

  reply.hijack();
  const raw = reply.raw;
  const headers: Record<string, string> = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };
  // CORS for the hijacked response (the CORS plugin's onSend hook no longer runs).
  if (request.headers.origin === ctx.env.webOrigin) {
    headers["access-control-allow-origin"] = ctx.env.webOrigin;
    headers["access-control-allow-credentials"] = "true";
  }
  raw.writeHead(200, headers);
  raw.write(`retry: 3000\n\n`);

  let lastSent = cursor;
  let closed = false;

  const send = (sequence: number, eventType: string, data: unknown) => {
    if (closed) return;
    raw.write(`id: ${sequence}\nevent: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    lastSent = Math.max(lastSent, sequence);
  };

  const endStream = (finalStatus: string) => {
    if (closed) return;
    raw.write(`event: stream.end\ndata: ${JSON.stringify({ runId, status: finalStatus })}\n\n`);
    cleanup();
    raw.end();
  };

  // Subscribe before replaying so no event published mid-replay is lost.
  const buffered: string[] = [];
  let replaying = true;
  const deliverLive = (message: string) => {
    const event = parsePublishedRunEvent(message);
    if (!event) return;
    if (event.sequence <= lastSent) return; // duplicate
    send(event.sequence, event.type, event);
    if (event.type === "state" && typeof event.metadata.status === "string") {
      const status = event.metadata.status;
      if (isTerminalRunStatus(status as never)) endStream(status);
    }
  };
  const unsubscribe = ctx.fanout.onRunEvent(runId, (message) => {
    if (replaying) buffered.push(message);
    else deliverLive(message);
  });

  const ping = setInterval(() => {
    if (!closed) raw.write(`: ping\n\n`);
  }, SSE_PING_INTERVAL_MS);
  ping.unref();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    unsubscribe();
  };
  request.raw.on("close", cleanup);

  try {
    const replayRows: RunEventRow[] = await ctx.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.sequence, cursor)))
      .orderBy(asc(runEvents.sequence));
    for (const row of replayRows) {
      send(row.sequence, row.type, {
        id: row.id,
        runId: row.runId,
        sequence: row.sequence,
        type: row.type,
        stream: row.stream,
        message: row.message,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
      });
    }
    replaying = false;
    for (const message of buffered) deliverLive(message);
    buffered.length = 0;

    // Re-check terminal state after replay: no further events will arrive.
    const [fresh] = await ctx.db
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    if (fresh && isTerminalRunStatus(fresh.status)) {
      endStream(fresh.status);
    }
  } catch (err) {
    request.log.error({ err, runId }, "SSE replay failed");
    cleanup();
    raw.end();
  }
}
