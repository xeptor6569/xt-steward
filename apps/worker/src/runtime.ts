import {
  createDatabase,
  nodes,
  runs,
  sessions,
  transitionRun,
  type Database,
} from "@steward/database";
import {
  MAINTENANCE_QUEUE,
  nodeCommandChannel,
  nodePresenceKey,
  QUEUE_RUN_DISPATCH,
  type InternalNodeCommand,
} from "@steward/protocol/internal";
import type { Logger } from "@steward/shared";
import { Queue, Worker, type Job } from "bullmq";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { z } from "zod";
import type { WorkerEnv } from "./env.js";

const dispatchJobSchema = z.object({ runId: z.string().min(1) });

export interface WorkerRuntime {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Exposed for integration tests. */
  runMaintenanceOnce: () => Promise<void>;
}

export function createWorkerRuntime(env: WorkerEnv, log: Logger): WorkerRuntime {
  const dbHandle = createDatabase(env.databaseUrl, { max: 5 });
  const db = dbHandle.db;
  const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
  const publish = (channel: string, message: string) => redis.publish(channel, message);

  let dispatchWorker: Worker | undefined;
  let maintenanceWorker: Worker | undefined;
  let maintenanceQueue: Queue | undefined;

  async function isNodePresent(nodeId: string): Promise<boolean> {
    return (await redis.exists(nodePresenceKey(nodeId))) === 1;
  }

  async function publishCommand(nodeId: string, command: InternalNodeCommand): Promise<void> {
    await publish(nodeCommandChannel(nodeId), JSON.stringify(command));
  }

  /**
   * Dispatch processor. Idempotent: BullMQ jobId equals the run id, and the
   * queued->dispatching transition is a conditional update, so duplicate
   * deliveries and concurrent workers cannot double-dispatch.
   */
  async function processDispatch(job: Job): Promise<void> {
    const { runId } = dispatchJobSchema.parse(job.data);
    const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (!run || run.status !== "queued") return;

    if (!(await isNodePresent(run.nodeId))) {
      throw new Error(`node ${run.nodeId} is offline`); // retried with backoff
    }

    const updated = await transitionRun(db, publish, runId, "dispatching", {}, { via: "worker" });
    if (!updated) return;
    await publishCommand(run.nodeId, { kind: "dispatch", runId });
    log.info({ runId, nodeId: run.nodeId }, "run dispatched");
  }

  /** Final failure after all retries: the owning node never came online. */
  async function handleDispatchExhausted(job: Job | undefined): Promise<void> {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;
    const parsed = dispatchJobSchema.safeParse(job.data);
    if (!parsed.success) return;
    const updated = await transitionRun(
      db,
      publish,
      parsed.data.runId,
      "failed",
      {
        finishedAt: new Date(),
        errorCode: "node_offline",
        errorMessage: "Node did not come online before dispatch retries were exhausted",
      },
      { via: "worker" },
    );
    if (updated) log.warn({ runId: parsed.data.runId }, "run failed: node offline");
  }

  async function runMaintenanceOnce(): Promise<void> {
    const now = Date.now();

    // 1. Nodes that stopped heartbeating (e.g. API crash) become offline.
    await db
      .update(nodes)
      .set({ status: "offline" })
      .where(
        and(
          eq(nodes.status, "online"),
          lt(nodes.lastHeartbeatAt, new Date(now - env.nodeOfflineAfterMs)),
        ),
      );

    // 2. Stuck dispatching runs: re-publish when the node is online, mark lost
    //    after the lost timeout when it is not.
    const stuckDispatching = await db
      .select()
      .from(runs)
      .where(and(eq(runs.status, "dispatching"), lt(runs.updatedAt, new Date(now - 15_000))));
    for (const run of stuckDispatching) {
      if (await isNodePresent(run.nodeId)) {
        await publishCommand(run.nodeId, { kind: "dispatch", runId: run.id });
      } else if (run.updatedAt.getTime() < now - env.runLostTimeoutMs) {
        await transitionRun(
          db,
          publish,
          run.id,
          "lost",
          { finishedAt: new Date(), errorCode: "node_lost_run" },
          { reason: "node_disconnected_while_dispatching" },
        );
      }
    }

    // 3. Active runs on nodes that have been gone past the lost timeout.
    const activeRuns = await db
      .select({ run: runs, nodeHeartbeat: nodes.lastHeartbeatAt })
      .from(runs)
      .innerJoin(nodes, eq(runs.nodeId, nodes.id))
      .where(inArray(runs.status, ["running", "cancellation_requested"]));
    for (const { run, nodeHeartbeat } of activeRuns) {
      const heartbeatAge = nodeHeartbeat ? now - nodeHeartbeat.getTime() : Number.POSITIVE_INFINITY;
      if (heartbeatAge > env.runLostTimeoutMs && !(await isNodePresent(run.nodeId))) {
        await transitionRun(
          db,
          publish,
          run.id,
          "lost",
          { finishedAt: new Date(), errorCode: "node_lost_run" },
          { reason: "node_disconnected_during_run" },
        );
        continue;
      }

      // 4. Server-side timeout backstop (the node enforces its own timeout;
      //    this catches nodes that heartbeat but never finish the run).
      if (
        run.status === "running" &&
        run.startedAt &&
        run.startedAt.getTime() < now - env.runTimeoutMs - 120_000
      ) {
        const updated = await transitionRun(
          db,
          publish,
          run.id,
          "timed_out",
          { finishedAt: new Date(), errorCode: "run_timeout" },
          { via: "worker" },
        );
        if (updated) {
          await publishCommand(run.nodeId, {
            kind: "cancel",
            runId: run.id,
            graceMs: 0,
            reason: "timeout",
          });
        }
        continue;
      }

      // 5. Cancellation that never completed: re-send while the node is online.
      if (
        run.status === "cancellation_requested" &&
        run.cancellationRequestedAt &&
        run.cancellationRequestedAt.getTime() < now - (env.cancelGraceMs * 2 + 15_000) &&
        (await isNodePresent(run.nodeId))
      ) {
        await publishCommand(run.nodeId, {
          kind: "cancel",
          runId: run.id,
          graceMs: env.cancelGraceMs,
          reason: "user_requested",
        });
      }
    }

    // 6. Expired session cleanup.
    await db.delete(sessions).where(lt(sessions.expiresAt, sql`now() - interval '1 day'`));
  }

  return {
    async start() {
      dispatchWorker = new Worker(QUEUE_RUN_DISPATCH, processDispatch, {
        connection: redis,
        concurrency: 10,
      });
      dispatchWorker.on("failed", (job, err) => {
        log.warn({ jobId: job?.id, err: err.message }, "dispatch attempt failed");
        void handleDispatchExhausted(job).catch((e: unknown) =>
          log.error({ err: e }, "failed to finalize exhausted dispatch"),
        );
      });
      dispatchWorker.on("error", (err) => log.error({ err }, "dispatch worker error"));

      maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection: redis });
      await maintenanceQueue.upsertJobScheduler("maintenance", {
        every: env.maintenanceIntervalMs,
      });
      maintenanceWorker = new Worker(
        MAINTENANCE_QUEUE,
        async () => {
          await runMaintenanceOnce();
        },
        { connection: redis, concurrency: 1 },
      );
      maintenanceWorker.on("error", (err) => log.error({ err }, "maintenance worker error"));
      log.info("Steward XT worker started");
    },
    async stop() {
      await dispatchWorker?.close();
      await maintenanceWorker?.close();
      await maintenanceQueue?.close();
      redis.disconnect();
      await dbHandle.close();
    },
    runMaintenanceOnce,
  };
}

export type { Database };
