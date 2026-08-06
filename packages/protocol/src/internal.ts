import { z } from "zod";

/**
 * Control-plane internal messaging contracts (worker <-> API over Redis).
 *
 * The worker schedules runs but never owns node WebSocket connections; the
 * API process holds sockets. The worker therefore publishes commands on a
 * per-node Redis channel and every API instance forwards commands for the
 * sockets it holds. Run events flow the other way: the API persists them and
 * republishes on a per-run channel for SSE fan-out.
 */

export const QUEUE_RUN_DISPATCH = "steward-run-dispatch";
export const MAINTENANCE_QUEUE = "steward-maintenance";

export const NODE_COMMAND_CHANNEL_PATTERN = "steward:cmd:node:*";
export const RUN_EVENTS_CHANNEL_PATTERN = "steward:events:run:*";

export function nodeCommandChannel(nodeId: string): string {
  return `steward:cmd:node:${nodeId}`;
}

export function nodeIdFromCommandChannel(channel: string): string | null {
  const prefix = "steward:cmd:node:";
  return channel.startsWith(prefix) ? channel.slice(prefix.length) : null;
}

export function runEventsChannel(runId: string): string {
  return `steward:events:run:${runId}`;
}

export function runIdFromEventsChannel(channel: string): string | null {
  const prefix = "steward:events:run:";
  return channel.startsWith(prefix) ? channel.slice(prefix.length) : null;
}

/** Redis key whose TTL-bound existence marks a node as connected somewhere. */
export function nodePresenceKey(nodeId: string): string {
  return `steward:presence:node:${nodeId}`;
}

export const internalNodeCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("dispatch"),
    runId: z.string().max(64),
  }),
  z.object({
    kind: z.literal("cancel"),
    runId: z.string().max(64),
    graceMs: z.number().int().min(0).max(600_000),
    reason: z.enum(["user_requested", "timeout", "reconciliation"]),
  }),
]);
export type InternalNodeCommand = z.infer<typeof internalNodeCommandSchema>;

export function parseInternalNodeCommand(raw: string): InternalNodeCommand | null {
  try {
    const result = internalNodeCommandSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Shape published on the per-run events channel and delivered over SSE. */
export const publishedRunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sequence: z.number().int(),
  type: z.enum(["log", "notice", "state"]),
  stream: z.enum(["stdout", "stderr"]).nullable(),
  message: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type PublishedRunEvent = z.infer<typeof publishedRunEventSchema>;

export function parsePublishedRunEvent(raw: string): PublishedRunEvent | null {
  try {
    const result = publishedRunEventSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
