import { z } from "zod";

export const RUN_STATUSES = [
  "queued",
  "dispatching",
  "running",
  "succeeded",
  "failed",
  "cancellation_requested",
  "cancelled",
  "timed_out",
  "lost",
] as const;

export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const TERMINAL_RUN_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "lost",
] as const satisfies readonly RunStatus[];

export const ACTIVE_RUN_STATUSES = [
  "queued",
  "dispatching",
  "running",
  "cancellation_requested",
] as const satisfies readonly RunStatus[];

/**
 * The single source of truth for the run state machine. Terminal states have
 * no outgoing transitions, so a terminal run can never become active again.
 *
 * Notes:
 * - `cancellation_requested -> succeeded/failed/timed_out` covers the race
 *   where the run finishes on the node before the cancel command lands.
 * - `queued -> cancelled` covers cancelling a run that was never dispatched.
 * - `dispatching/running/cancellation_requested -> lost` is applied by the
 *   worker reaper when the owning node stays disconnected past the timeout.
 */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ["dispatching", "cancelled", "failed"],
  dispatching: ["running", "cancellation_requested", "succeeded", "failed", "timed_out", "lost"],
  running: ["succeeded", "failed", "cancellation_requested", "timed_out", "lost"],
  cancellation_requested: ["cancelled", "succeeded", "failed", "timed_out", "lost"],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
  lost: [],
};

export function isTerminalRunStatus(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

/** Statuses from which `to` is reachable, for conditional SQL updates. */
export function statusesAllowingTransitionTo(to: RunStatus): RunStatus[] {
  return RUN_STATUSES.filter((from) => RUN_TRANSITIONS[from].includes(to));
}
