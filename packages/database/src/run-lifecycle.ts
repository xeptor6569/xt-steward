import { newId, statusesAllowingTransitionTo, type RunStatus } from "@steward/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./client.js";
import { isUniqueViolation } from "./client.js";
import { runEvents, runs } from "./schema.js";

/** Callback used to fan out run events (Redis publish in production). */
export type PublishFn = (channel: string, message: string) => Promise<unknown>;

function runEventsChannel(runId: string): string {
  return `steward:events:run:${runId}`;
}

export type RunRow = typeof runs.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;

export function serializeRunEvent(row: RunEventRow): string {
  return JSON.stringify({
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

export interface InsertRunEventInput {
  runId: string;
  type: "log" | "notice" | "state";
  stream?: "stdout" | "stderr" | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
  /** Node-assigned per-run sequence for de-duplication; null for server events. */
  sourceSequence?: number | null;
  createdAt?: Date;
}

/**
 * Persists a run event and publishes it for SSE fan-out. Duplicate node
 * messages (same runId + sourceSequence) are absorbed via the partial unique
 * index and return null instead of throwing.
 */
export async function insertRunEvent(
  db: Database,
  publish: PublishFn,
  input: InsertRunEventInput,
): Promise<RunEventRow | null> {
  let row: RunEventRow | undefined;
  try {
    const values: typeof runEvents.$inferInsert = {
      id: newId("revt"),
      runId: input.runId,
      sourceSequence: input.sourceSequence ?? null,
      type: input.type,
      stream: input.stream ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? {},
    };
    if (input.createdAt) values.createdAt = input.createdAt;
    [row] = await db.insert(runEvents).values(values).returning();
  } catch (err) {
    if (isUniqueViolation(err)) return null; // duplicate delivery
    throw err;
  }
  if (!row) return null;
  await publish(runEventsChannel(input.runId), serializeRunEvent(row));
  return row;
}

export interface TransitionPatch {
  startedAt?: Date;
  finishedAt?: Date;
  exitCode?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  cancellationRequestedAt?: Date;
}

/**
 * Atomically transitions a run to `to`, but only from states the state
 * machine allows (single conditional UPDATE). Returns the updated run or
 * null when the transition was not permitted (e.g. the run is already
 * terminal). On success a `state` run event is persisted and published.
 */
export async function transitionRun(
  db: Database,
  publish: PublishFn,
  runId: string,
  to: RunStatus,
  patch: TransitionPatch = {},
  eventMetadata: Record<string, unknown> = {},
): Promise<RunRow | null> {
  const allowedFrom = statusesAllowingTransitionTo(to);
  if (allowedFrom.length === 0) return null;

  const [updated] = await db
    .update(runs)
    .set({ status: to, ...patch })
    .where(and(eq(runs.id, runId), inArray(runs.status, allowedFrom)))
    .returning();
  if (!updated) return null;

  await insertRunEvent(db, publish, {
    runId,
    type: "state",
    message: `Run ${to.replace(/_/g, " ")}`,
    metadata: { status: to, ...eventMetadata },
  });
  return updated;
}
