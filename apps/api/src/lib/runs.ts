import {
  agentDefinitions,
  insertRunEvent,
  nodes,
  runs,
  transitionRun,
  workspaces,
  type RunRow,
} from "@steward/database";
import { nodeCommandChannel, type InternalNodeCommand } from "@steward/protocol/internal";
import { AppError, isTerminalRunStatus, newId } from "@steward/shared";
import { and, eq } from "drizzle-orm";
import type { AppContext } from "../context.js";
import { recordAudit } from "./audit.js";

export interface CreateRunInput {
  workspaceId: string;
  type: "diagnostic";
  task: string | null;
  requestedByUserId: string;
}

export async function createRun(ctx: AppContext, input: CreateRunInput): Promise<RunRow> {
  const [workspace] = await ctx.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .limit(1);
  if (!workspace) throw AppError.notFound("Workspace");
  if (!workspace.enabled) {
    throw AppError.conflict("workspace_disabled", "Workspace is disabled on its node");
  }

  const [node] = await ctx.db.select().from(nodes).where(eq(nodes.id, workspace.nodeId)).limit(1);
  if (!node) throw AppError.notFound("Node");

  const [agent] = await ctx.db
    .select()
    .from(agentDefinitions)
    .where(
      and(
        eq(agentDefinitions.nodeId, node.id),
        eq(agentDefinitions.type, input.type),
        eq(agentDefinitions.enabled, true),
      ),
    )
    .limit(1);
  if (!agent) {
    throw AppError.conflict(
      "agent_unavailable",
      `Node "${node.name}" does not advertise an enabled ${input.type} agent`,
    );
  }

  const [run] = await ctx.db
    .insert(runs)
    .values({
      id: newId("run"),
      workspaceId: workspace.id,
      nodeId: node.id,
      agentDefinitionId: agent.id,
      type: input.type,
      status: "queued",
      requestedByUserId: input.requestedByUserId,
      task: input.task,
    })
    .returning();
  if (!run) throw new AppError("run_create_failed", "Failed to create run");

  await insertRunEvent(ctx.db, ctx.publish, {
    runId: run.id,
    type: "state",
    message: "Run queued",
    metadata: { status: "queued" },
  });
  await recordAudit(ctx.db, {
    actorType: "user",
    actorId: input.requestedByUserId,
    action: "run.created",
    targetType: "run",
    targetId: run.id,
    metadata: { workspaceId: workspace.id, nodeId: node.id, type: input.type },
  });

  // jobId = run id makes queue delivery idempotent: BullMQ ignores duplicates
  // and the worker additionally checks the run is still `queued`.
  await ctx.runDispatchQueue.add(
    "dispatch",
    { runId: run.id },
    {
      jobId: run.id,
      attempts: 8,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  );
  return run;
}

export interface CancelResult {
  run: RunRow;
  alreadyTerminal: boolean;
}

/**
 * Idempotent cancellation. Queued runs are cancelled immediately; active runs
 * move to cancellation_requested and the owning node is told to terminate the
 * process group. Terminal runs are returned unchanged.
 */
export async function cancelRun(
  ctx: AppContext,
  runId: string,
  requestedByUserId: string,
): Promise<CancelResult> {
  const [run] = await ctx.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw AppError.notFound("Run");

  if (isTerminalRunStatus(run.status)) {
    return { run, alreadyTerminal: true };
  }

  const now = new Date();

  if (run.status === "queued") {
    const updated = await transitionRun(
      ctx.db,
      ctx.publish,
      runId,
      "cancelled",
      { finishedAt: now, cancellationRequestedAt: now },
      { reason: "user_requested" },
    );
    if (updated) {
      const job = await ctx.runDispatchQueue.getJob(runId);
      if (job) await job.remove().catch(() => undefined);
      await recordAudit(ctx.db, {
        actorType: "user",
        actorId: requestedByUserId,
        action: "run.cancelled",
        targetType: "run",
        targetId: runId,
      });
      return { run: updated, alreadyTerminal: false };
    }
    // Lost the race with dispatch; fall through to the active-run path.
  }

  const updated = await transitionRun(
    ctx.db,
    ctx.publish,
    runId,
    "cancellation_requested",
    { cancellationRequestedAt: now },
    { reason: "user_requested" },
  );
  const current =
    updated ?? (await ctx.db.select().from(runs).where(eq(runs.id, runId)).limit(1))[0];
  if (!current) throw AppError.notFound("Run");

  if (updated) {
    await recordAudit(ctx.db, {
      actorType: "user",
      actorId: requestedByUserId,
      action: "run.cancellation_requested",
      targetType: "run",
      targetId: runId,
    });
  }

  // (Re-)send the cancel command even when the transition was a no-op so a
  // repeated cancel click re-delivers after a dropped message. Idempotent on
  // the node side.
  if (!isTerminalRunStatus(current.status)) {
    const command: InternalNodeCommand = {
      kind: "cancel",
      runId,
      graceMs: ctx.env.cancelGraceMs,
      reason: "user_requested",
    };
    await ctx.publish(nodeCommandChannel(current.nodeId), JSON.stringify(command));
  }

  return { run: current, alreadyTerminal: isTerminalRunStatus(current.status) };
}
