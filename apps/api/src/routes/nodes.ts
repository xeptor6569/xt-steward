import { agentDefinitions, nodes, runs, workspaces } from "@steward/database";
import { ACTIVE_RUN_STATUSES, AppError } from "@steward/shared";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../context.js";
import {
  agentDtoSchema,
  errorResponseSchema,
  nodeDtoSchema,
  runDtoSchema,
  toAgentDto,
  toNodeDto,
  toRunDto,
  toWorkspaceDto,
  workspaceDtoSchema,
} from "../lib/dtos.js";
import { requireUser } from "../plugins/auth.js";

export function registerNodeRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/nodes",
    {
      schema: {
        tags: ["nodes"],
        summary: "List nodes with presence and active run counts",
        response: { 200: z.object({ nodes: z.array(nodeDtoSchema) }) },
      },
      preHandler: [requireUser(ctx)],
    },
    async () => {
      const rows = await ctx.db.select().from(nodes).orderBy(nodes.name);
      const counts = await ctx.db
        .select({ nodeId: runs.nodeId, count: sql<number>`count(*)::int` })
        .from(runs)
        .where(inArray(runs.status, [...ACTIVE_RUN_STATUSES]))
        .groupBy(runs.nodeId);
      const countByNode = new Map(counts.map((c) => [c.nodeId, c.count]));
      return { nodes: rows.map((row) => toNodeDto(row, countByNode.get(row.id) ?? 0)) };
    },
  );

  r.get(
    "/nodes/:id",
    {
      schema: {
        tags: ["nodes"],
        summary: "Node details with workspaces, agents, and recent runs",
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({
            node: nodeDtoSchema,
            workspaces: z.array(workspaceDtoSchema),
            agents: z.array(agentDtoSchema),
            recentRuns: z.array(runDtoSchema),
          }),
          404: errorResponseSchema,
        },
      },
      preHandler: [requireUser(ctx)],
    },
    async (request) => {
      const [node] = await ctx.db
        .select()
        .from(nodes)
        .where(eq(nodes.id, request.params.id))
        .limit(1);
      if (!node) throw AppError.notFound("Node");

      const [workspaceRows, agentRows, runRows, activeCount] = await Promise.all([
        ctx.db.select().from(workspaces).where(eq(workspaces.nodeId, node.id)),
        ctx.db.select().from(agentDefinitions).where(eq(agentDefinitions.nodeId, node.id)),
        ctx.db
          .select({ run: runs, workspaceName: workspaces.name })
          .from(runs)
          .leftJoin(workspaces, eq(runs.workspaceId, workspaces.id))
          .where(eq(runs.nodeId, node.id))
          .orderBy(desc(runs.createdAt))
          .limit(20),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(runs)
          .where(
            sql`${runs.nodeId} = ${node.id} and ${inArray(runs.status, [...ACTIVE_RUN_STATUSES])}`,
          ),
      ]);

      return {
        node: toNodeDto(node, activeCount[0]?.count ?? 0),
        workspaces: workspaceRows.map((w) =>
          toWorkspaceDto(w, { name: node.name, status: node.status }),
        ),
        agents: agentRows.map(toAgentDto),
        recentRuns: runRows.map(({ run, workspaceName }) =>
          toRunDto(run, { workspaceName, nodeName: node.name }),
        ),
      };
    },
  );
}

export function registerWorkspaceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/workspaces",
    {
      schema: {
        tags: ["workspaces"],
        summary: "List all workspaces advertised by nodes",
        response: { 200: z.object({ workspaces: z.array(workspaceDtoSchema) }) },
      },
      preHandler: [requireUser(ctx)],
    },
    async () => {
      const rows = await ctx.db
        .select({ workspace: workspaces, nodeName: nodes.name, nodeStatus: nodes.status })
        .from(workspaces)
        .innerJoin(nodes, eq(workspaces.nodeId, nodes.id))
        .orderBy(nodes.name, workspaces.name);
      return {
        workspaces: rows.map(({ workspace, nodeName, nodeStatus }) =>
          toWorkspaceDto(workspace, { name: nodeName, status: nodeStatus }),
        ),
      };
    },
  );
}
