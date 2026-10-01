import {
  agentDefinitions,
  insertRunEvent,
  nodes,
  runs,
  transitionRun,
  workspaces,
} from "@steward/database";
import {
  createServerMessage,
  MAX_WS_MESSAGE_BYTES,
  parseNodeToServerMessage,
  serializeMessage,
  type NodeToServerMessage,
  type ServerToNodeMessage,
} from "@steward/protocol";
import { nodeIdFromCommandChannel, parseInternalNodeCommand } from "@steward/protocol/internal";
import { hashSecretToken, newId, type Logger } from "@steward/shared";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { AppContext } from "../context.js";
import { recordAudit } from "../lib/audit.js";
import { clearNodePresence, markNodePresent } from "../lib/presence.js";

type NodeRow = typeof nodes.$inferSelect;

declare module "fastify" {
  interface FastifyRequest {
    stewardNode?: NodeRow;
  }
}

interface Connection {
  connectionId: string;
  nodeId: string;
  nodeName: string;
  socket: WebSocket;
  helloReceived: boolean;
  /** Serializes message handling so run events persist in arrival order. */
  inbox: Promise<void>;
  livenessTimer?: NodeJS.Timeout;
  helloTimer?: NodeJS.Timeout;
}

const HELLO_TIMEOUT_MS = 10_000;

/**
 * Owns node WebSocket connections for this API process.
 *
 * Nodes connect outbound with a bearer credential; the first frame must be a
 * `node.hello` advertising workspaces, agents, and still-active runs. Run
 * commands arrive from the worker over Redis (this process may not be the one
 * holding the socket, so every API instance subscribes and forwards only for
 * sockets it owns).
 */
export class NodeGateway {
  private readonly connections = new Map<string, Connection>();
  private readonly log: Logger;
  private unsubscribe?: () => void;

  constructor(private readonly ctx: AppContext) {
    this.log = ctx.log.child({ component: "node-gateway" });
  }

  register(app: FastifyInstance): void {
    this.unsubscribe = this.ctx.fanout.onNodeCommand((channel, message) => {
      void this.handleInternalCommand(channel, message).catch((err: unknown) => {
        this.log.error({ err, channel }, "failed to handle internal node command");
      });
    });

    app.get(
      "/node-gateway",
      {
        websocket: true,
        // Bearer authentication happens before the upgrade completes.
        preValidation: async (request, reply) => {
          const node = await this.authenticate(request);
          if (!node) {
            await reply.status(401).send({
              error: { code: "unauthorized", message: "Invalid node credential" },
            });
            return;
          }
          request.stewardNode = node;
        },
        config: { rateLimit: false },
        schema: {
          tags: ["node-gateway"],
          summary: "Node WebSocket gateway (protocol v1, bearer credential)",
          hide: false,
        },
      },
      (socket: WebSocket, request: FastifyRequest) => {
        const node = request.stewardNode;
        if (!node) {
          socket.close(1008, "unauthorized");
          return;
        }
        this.handleConnection(socket, node);
      },
    );

    app.addHook("onClose", async () => {
      this.unsubscribe?.();
      for (const conn of this.connections.values()) {
        conn.socket.close(1001, "server shutting down");
      }
    });
  }

  private async authenticate(request: FastifyRequest): Promise<NodeRow | null> {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer stx_node_")) return null;
    const credentialHash = hashSecretToken(header.slice("Bearer ".length));
    const [node] = await this.ctx.db
      .select()
      .from(nodes)
      .where(eq(nodes.credentialHash, credentialHash))
      .limit(1);
    return node ?? null;
  }

  private handleConnection(socket: WebSocket, node: NodeRow): void {
    // A reconnect supersedes any lingering connection for the same node.
    const existing = this.connections.get(node.id);
    if (existing) {
      this.log.info({ nodeId: node.id }, "superseding existing node connection");
      existing.socket.close(4000, "superseded by new connection");
      this.connections.delete(node.id);
    }

    const conn: Connection = {
      connectionId: newId("msg"),
      nodeId: node.id,
      nodeName: node.name,
      socket,
      helloReceived: false,
      inbox: Promise.resolve(),
    };
    this.connections.set(node.id, conn);

    conn.helloTimer = setTimeout(() => {
      this.sendError(conn, "hello_timeout", "node.hello not received in time");
      socket.close(4001, "hello timeout");
    }, HELLO_TIMEOUT_MS);

    socket.on("message", (raw: Buffer, isBinary: boolean) => {
      if (isBinary || raw.length > MAX_WS_MESSAGE_BYTES) {
        this.sendError(conn, "invalid_message", "binary or oversized frame");
        return;
      }
      conn.inbox = conn.inbox.then(() =>
        this.handleMessage(conn, raw).catch((err: unknown) => {
          this.log.error({ err, nodeId: conn.nodeId }, "error handling node message");
        }),
      );
    });

    socket.on("close", () => {
      void this.handleDisconnect(conn).catch((err: unknown) => {
        this.log.error({ err, nodeId: conn.nodeId }, "error handling node disconnect");
      });
    });

    socket.on("error", (err) => {
      this.log.warn({ err, nodeId: conn.nodeId }, "node socket error");
    });
  }

  private async handleMessage(conn: Connection, raw: Buffer): Promise<void> {
    const parsed = parseNodeToServerMessage(raw);
    if (!parsed.ok || !parsed.message) {
      this.log.warn({ nodeId: conn.nodeId, error: parsed.error }, "invalid node message");
      this.sendError(conn, "invalid_message", parsed.error ?? "invalid message");
      return;
    }
    const message = parsed.message;

    if (!conn.helloReceived && message.type !== "node.hello") {
      this.sendError(conn, "hello_required", "first message must be node.hello");
      return;
    }

    this.touchLiveness(conn);

    switch (message.type) {
      case "node.hello":
        await this.handleHello(conn, message);
        break;
      case "node.heartbeat":
        await this.handleHeartbeat(conn, message.payload.activeRunIds);
        break;
      case "run.accepted":
        if (!message.payload.accepted) {
          await transitionRun(
            this.ctx.db,
            this.ctx.publish,
            message.payload.runId,
            "failed",
            {
              finishedAt: new Date(),
              errorCode: "node_rejected",
              errorMessage: message.payload.reason ?? "node rejected the run",
            },
            { nodeId: conn.nodeId },
          );
        }
        break;
      case "run.started":
        await transitionRun(
          this.ctx.db,
          this.ctx.publish,
          message.payload.runId,
          "running",
          { startedAt: new Date(message.payload.startedAt) },
          { nodeId: conn.nodeId },
        );
        break;
      case "run.event":
        await this.handleRunEvent(conn, message);
        break;
      case "run.finished":
        await this.handleRunFinished(conn, message);
        break;
    }
  }

  private async handleHello(
    conn: Connection,
    message: Extract<NodeToServerMessage, { type: "node.hello" }>,
  ): Promise<void> {
    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    conn.helloReceived = true;
    const payload = message.payload;
    const now = new Date();

    const capabilities = {
      ...payload.capabilities,
      "os.platform": payload.os.platform,
      "os.release": payload.os.release,
      "os.arch": payload.os.arch,
      "runtime.node": payload.runtime.node,
    };

    await this.ctx.db
      .update(nodes)
      .set({
        status: "online",
        version: payload.nodeVersion,
        labels: payload.labels,
        capabilities,
        maxConcurrentRuns: payload.maxConcurrentRuns,
        lastConnectedAt: now,
        lastHeartbeatAt: now,
      })
      .where(eq(nodes.id, conn.nodeId));
    await markNodePresent(this.ctx.redis, conn.nodeId, this.ctx.env.nodeOfflineAfterMs);

    await this.syncWorkspaces(conn.nodeId, payload.workspaces);
    await this.syncAgents(conn.nodeId, payload.agents);

    const runsToCancel = await this.reconcileRuns(conn, payload.activeRunIds);

    this.send(
      conn,
      createServerMessage("server.hello_ok", {
        nodeId: conn.nodeId,
        serverTime: now.toISOString(),
        heartbeatIntervalMs: this.ctx.env.heartbeatIntervalMs,
        runsToCancel,
      }),
    );

    await recordAudit(this.ctx.db, {
      actorType: "node",
      actorId: conn.nodeId,
      action: "node.connected",
      targetType: "node",
      targetId: conn.nodeId,
      metadata: {
        version: payload.nodeVersion,
        workspaces: payload.workspaces.length,
        agents: payload.agents.length,
      },
    });
    this.log.info({ nodeId: conn.nodeId, nodeName: conn.nodeName }, "node connected");
  }

  private async syncWorkspaces(
    nodeId: string,
    advertised: Extract<NodeToServerMessage, { type: "node.hello" }>["payload"]["workspaces"],
  ): Promise<void> {
    for (const ws of advertised) {
      await this.ctx.db
        .insert(workspaces)
        .values({
          id: newId("ws"),
          nodeId,
          externalKey: ws.key,
          name: ws.name,
          localPath: ws.localPath,
          repositoryUrl: ws.repositoryUrl ?? null,
          defaultBranch: ws.defaultBranch ?? null,
          readOnly: ws.readOnly,
          enabled: true,
        })
        .onConflictDoUpdate({
          target: [workspaces.nodeId, workspaces.externalKey],
          set: {
            name: ws.name,
            localPath: ws.localPath,
            repositoryUrl: ws.repositoryUrl ?? null,
            defaultBranch: ws.defaultBranch ?? null,
            readOnly: ws.readOnly,
            enabled: true,
            updatedAt: new Date(),
          },
        });
    }
    const keys = advertised.map((w) => w.key);
    await this.ctx.db
      .update(workspaces)
      .set({ enabled: false, updatedAt: new Date() })
      .where(
        keys.length > 0
          ? and(eq(workspaces.nodeId, nodeId), notInArray(workspaces.externalKey, keys))
          : eq(workspaces.nodeId, nodeId),
      );
  }

  private async syncAgents(
    nodeId: string,
    advertised: Extract<NodeToServerMessage, { type: "node.hello" }>["payload"]["agents"],
  ): Promise<void> {
    for (const agent of advertised) {
      await this.ctx.db
        .insert(agentDefinitions)
        .values({
          id: newId("agent"),
          nodeId,
          externalKey: agent.key,
          type: agent.type,
          name: agent.name,
          version: agent.version ?? null,
          enabled: agent.enabled,
          capabilities: agent.capabilities,
        })
        .onConflictDoUpdate({
          target: [agentDefinitions.nodeId, agentDefinitions.externalKey],
          set: {
            type: agent.type,
            name: agent.name,
            version: agent.version ?? null,
            enabled: agent.enabled,
            capabilities: agent.capabilities,
            updatedAt: new Date(),
          },
        });
    }
    const keys = advertised.map((a) => a.key);
    await this.ctx.db
      .update(agentDefinitions)
      .set({ enabled: false, updatedAt: new Date() })
      .where(
        keys.length > 0
          ? and(eq(agentDefinitions.nodeId, nodeId), notInArray(agentDefinitions.externalKey, keys))
          : eq(agentDefinitions.nodeId, nodeId),
      );
  }

  /**
   * Reconciles run state after (re)connect:
   * - active in DB and still reported by the node: keep; re-issue pending cancels
   * - `dispatching` in DB, unknown to the node: re-dispatch (delivery was lost)
   * - `running`/`cancellation_requested` in DB, unknown to the node: mark lost
   * - reported by the node but terminal/unknown in DB: tell the node to cancel
   */
  private async reconcileRuns(
    conn: Connection,
    reportedRunIds: string[],
  ): Promise<{ runId: string; graceMs: number }[]> {
    const reported = new Set(reportedRunIds);
    const activeDbRuns = await this.ctx.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.nodeId, conn.nodeId),
          inArray(runs.status, ["dispatching", "running", "cancellation_requested"]),
        ),
      );

    const runsToCancel: { runId: string; graceMs: number }[] = [];
    const redispatch: string[] = [];

    for (const run of activeDbRuns) {
      if (reported.has(run.id)) {
        if (run.status === "cancellation_requested") {
          runsToCancel.push({ runId: run.id, graceMs: this.ctx.env.cancelGraceMs });
        }
        continue;
      }
      if (run.status === "dispatching") {
        redispatch.push(run.id);
        continue;
      }
      await transitionRun(
        this.ctx.db,
        this.ctx.publish,
        run.id,
        "lost",
        { finishedAt: new Date(), errorCode: "node_lost_run" },
        { reason: "not_reported_after_reconnect", nodeId: conn.nodeId },
      );
    }

    for (const runId of reported) {
      if (!activeDbRuns.some((r) => r.id === runId)) {
        runsToCancel.push({ runId, graceMs: 0 });
      }
    }

    // Re-send lost dispatches after hello_ok has gone out.
    if (redispatch.length > 0) {
      setImmediate(() => {
        for (const runId of redispatch) {
          void this.sendDispatch(conn.nodeId, runId).catch((err: unknown) => {
            this.log.error({ err, runId }, "re-dispatch after reconnect failed");
          });
        }
      });
    }

    return runsToCancel;
  }

  private async handleHeartbeat(conn: Connection, _activeRunIds: string[]): Promise<void> {
    const now = new Date();
    await markNodePresent(this.ctx.redis, conn.nodeId, this.ctx.env.nodeOfflineAfterMs);
    await this.ctx.db
      .update(nodes)
      .set({ status: "online", lastHeartbeatAt: now })
      .where(eq(nodes.id, conn.nodeId));
  }

  private async handleRunEvent(
    conn: Connection,
    message: Extract<NodeToServerMessage, { type: "run.event" }>,
  ): Promise<void> {
    const p = message.payload;
    const owned = await this.runBelongsToNode(p.runId, conn.nodeId);
    if (!owned) {
      this.log.warn({ nodeId: conn.nodeId, runId: p.runId }, "event for run not owned by node");
      return;
    }
    await insertRunEvent(this.ctx.db, this.ctx.publish, {
      runId: p.runId,
      type: p.eventType,
      stream: p.stream ?? null,
      message: p.message ?? null,
      metadata: p.metadata ?? {},
      sourceSequence: p.sequence,
      createdAt: new Date(p.occurredAt),
    });
  }

  private async handleRunFinished(
    conn: Connection,
    message: Extract<NodeToServerMessage, { type: "run.finished" }>,
  ): Promise<void> {
    const p = message.payload;
    const owned = await this.runBelongsToNode(p.runId, conn.nodeId);
    if (!owned) {
      this.log.warn({ nodeId: conn.nodeId, runId: p.runId }, "finish for run not owned by node");
      return;
    }
    await transitionRun(
      this.ctx.db,
      this.ctx.publish,
      p.runId,
      p.result,
      {
        finishedAt: new Date(p.finishedAt),
        exitCode: p.exitCode ?? null,
        errorCode: p.errorCode ?? null,
        errorMessage: p.errorMessage ?? null,
      },
      { nodeId: conn.nodeId },
    );
  }

  private async runBelongsToNode(runId: string, nodeId: string): Promise<boolean> {
    const [run] = await this.ctx.db
      .select({ nodeId: runs.nodeId })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    return run?.nodeId === nodeId;
  }

  private async handleDisconnect(conn: Connection): Promise<void> {
    if (conn.livenessTimer) clearTimeout(conn.livenessTimer);
    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    const current = this.connections.get(conn.nodeId);
    if (current?.connectionId !== conn.connectionId) return; // superseded

    this.connections.delete(conn.nodeId);
    await clearNodePresence(this.ctx.redis, conn.nodeId);
    await this.ctx.db.update(nodes).set({ status: "offline" }).where(eq(nodes.id, conn.nodeId));
    if (conn.helloReceived) {
      await recordAudit(this.ctx.db, {
        actorType: "node",
        actorId: conn.nodeId,
        action: "node.disconnected",
        targetType: "node",
        targetId: conn.nodeId,
      });
    }
    this.log.info({ nodeId: conn.nodeId }, "node disconnected");
  }

  /** Terminates the connection when nothing arrives for 2.5 heartbeat intervals. */
  private touchLiveness(conn: Connection): void {
    if (conn.livenessTimer) clearTimeout(conn.livenessTimer);
    conn.livenessTimer = setTimeout(() => {
      this.log.warn({ nodeId: conn.nodeId }, "node liveness timeout; terminating socket");
      conn.socket.terminate();
    }, this.ctx.env.heartbeatIntervalMs * 2.5);
    conn.livenessTimer.unref();
  }

  private async handleInternalCommand(channel: string, message: string): Promise<void> {
    const nodeId = nodeIdFromCommandChannel(channel);
    if (!nodeId) return;
    const conn = this.connections.get(nodeId);
    if (!conn || !conn.helloReceived) return; // another instance may own the socket

    const command = parseInternalNodeCommand(message);
    if (!command) {
      this.log.warn({ channel }, "invalid internal node command");
      return;
    }

    if (command.kind === "dispatch") {
      await this.sendDispatch(nodeId, command.runId);
    } else {
      this.send(
        conn,
        createServerMessage("run.cancel", {
          runId: command.runId,
          graceMs: command.graceMs,
          reason: command.reason,
        }),
      );
    }
  }

  private async sendDispatch(nodeId: string, runId: string): Promise<void> {
    const conn = this.connections.get(nodeId);
    if (!conn) return;

    const [row] = await this.ctx.db
      .select({
        run: runs,
        workspaceKey: workspaces.externalKey,
        agentKey: agentDefinitions.externalKey,
      })
      .from(runs)
      .innerJoin(workspaces, eq(runs.workspaceId, workspaces.id))
      .leftJoin(agentDefinitions, eq(runs.agentDefinitionId, agentDefinitions.id))
      .where(eq(runs.id, runId))
      .limit(1);
    if (!row || row.run.status !== "dispatching") return;
    if (row.run.nodeId !== nodeId) return;

    this.send(
      conn,
      createServerMessage("run.dispatch", {
        runId,
        runType: row.run.type,
        workspaceKey: row.workspaceKey,
        agentKey: row.agentKey ?? "diagnostic",
        task: row.run.task,
        timeoutMs: this.ctx.env.runTimeoutMs,
        cancelGraceMs: this.ctx.env.cancelGraceMs,
      }),
    );
  }

  private send(conn: Connection, message: ServerToNodeMessage): void {
    if (conn.socket.readyState === conn.socket.OPEN) {
      conn.socket.send(serializeMessage(message));
    }
  }

  private sendError(conn: Connection, code: string, errorMessage: string): void {
    this.send(conn, createServerMessage("server.error", { code, message: errorMessage }));
  }
}
