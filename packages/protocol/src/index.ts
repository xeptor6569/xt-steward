import { newId } from "@steward/shared";
import { z } from "zod";

/**
 * Steward XT node <-> control-plane protocol, version 1.
 *
 * Every WebSocket frame is a JSON envelope carrying a protocol version, a
 * stable message ID (for tracing and idempotency), a type, a timestamp, and a
 * typed payload. Both sides validate every frame with these Zod schemas
 * before acting on it. See docs/node-protocol.md.
 */
export const PROTOCOL_VERSION = 1;

/** Upper bound enforced by both sides before JSON parsing. */
export const MAX_WS_MESSAGE_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// Common fragments
// ---------------------------------------------------------------------------

/**
 * Workspace/agent keys are chosen by the node operator in the local node
 * config. They are the only identifier the control plane may use to refer to
 * a location on a node: never a filesystem path. The pattern forbids path
 * separators and dots outright.
 */
export const externalKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    "must be lowercase alphanumeric with dashes/underscores, starting alphanumeric",
  );

export const isoTimestampSchema = z.iso.datetime({ offset: true });

export const labelsSchema = z.record(z.string().max(64), z.string().max(256));

export const capabilitiesSchema = z.record(
  z.string().max(64),
  z.union([z.string().max(512), z.number(), z.boolean()]),
);

export const workspaceAdvertisementSchema = z.object({
  key: externalKeySchema,
  name: z.string().min(1).max(120),
  /** Canonical absolute path, advertised for display only (node -> server). */
  localPath: z.string().min(1).max(1024),
  readOnly: z.boolean(),
  repositoryUrl: z.string().max(512).nullish(),
  defaultBranch: z.string().max(255).nullish(),
});
export type WorkspaceAdvertisement = z.infer<typeof workspaceAdvertisementSchema>;

export const agentTypeSchema = z.enum(["diagnostic"]);
export type AgentType = z.infer<typeof agentTypeSchema>;

export const agentAdvertisementSchema = z.object({
  key: externalKeySchema,
  type: agentTypeSchema,
  name: z.string().min(1).max(120),
  version: z.string().max(64).nullish(),
  enabled: z.boolean(),
  capabilities: capabilitiesSchema.default({}),
});
export type AgentAdvertisement = z.infer<typeof agentAdvertisementSchema>;

/** Result states a node is allowed to report for a finished run. */
export const runResultSchema = z.enum(["succeeded", "failed", "cancelled", "timed_out"]);
export type RunResult = z.infer<typeof runResultSchema>;

export const runEventTypeSchema = z.enum(["log", "notice"]);
export const runStreamSchema = z.enum(["stdout", "stderr"]);

// ---------------------------------------------------------------------------
// Node -> server payloads
// ---------------------------------------------------------------------------

export const nodeHelloPayloadSchema = z.object({
  nodeName: z.string().min(1).max(120),
  nodeVersion: z.string().min(1).max(64),
  os: z.object({
    platform: z.string().max(64),
    release: z.string().max(128),
    arch: z.string().max(32),
  }),
  runtime: z.object({ node: z.string().max(64) }),
  labels: labelsSchema.default({}),
  capabilities: capabilitiesSchema.default({}),
  maxConcurrentRuns: z.number().int().min(1).max(64),
  workspaces: z.array(workspaceAdvertisementSchema).max(128),
  agents: z.array(agentAdvertisementSchema).max(64),
  /** Runs the node believes are still executing (reconciliation after reconnect). */
  activeRunIds: z.array(z.string().max(64)).max(256),
});

export const nodeHeartbeatPayloadSchema = z.object({
  activeRunIds: z.array(z.string().max(64)).max(256),
});

export const runAcceptedPayloadSchema = z.object({
  runId: z.string().max(64),
  accepted: z.boolean(),
  reason: z.string().max(512).optional(),
});

export const runStartedPayloadSchema = z.object({
  runId: z.string().max(64),
  startedAt: isoTimestampSchema,
});

export const runEventPayloadSchema = z.object({
  runId: z.string().max(64),
  /** Node-assigned, strictly increasing per run. Used for de-duplication. */
  sequence: z.number().int().min(1),
  eventType: runEventTypeSchema,
  stream: runStreamSchema.optional(),
  message: z
    .string()
    .max(16 * 1024)
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  occurredAt: isoTimestampSchema,
});

export const runFinishedPayloadSchema = z.object({
  runId: z.string().max(64),
  result: runResultSchema,
  exitCode: z.number().int().nullish(),
  errorCode: z.string().max(128).nullish(),
  errorMessage: z.string().max(4096).nullish(),
  finishedAt: isoTimestampSchema,
});

// ---------------------------------------------------------------------------
// Server -> node payloads
// ---------------------------------------------------------------------------

export const serverHelloOkPayloadSchema = z.object({
  nodeId: z.string().max(64),
  serverTime: isoTimestampSchema,
  heartbeatIntervalMs: z.number().int().min(1000).max(300_000),
  /** Runs the server considers dead (e.g. marked lost while disconnected). */
  runsToCancel: z.array(z.object({ runId: z.string().max(64), graceMs: z.number().int().min(0) })),
});

export const serverErrorPayloadSchema = z.object({
  code: z.string().max(128),
  message: z.string().max(1024),
});

export const runDispatchPayloadSchema = z.object({
  runId: z.string().max(64),
  runType: z.enum(["diagnostic"]),
  /**
   * Only opaque keys previously advertised by this node. The control plane
   * never sends filesystem paths; the node resolves keys against its own
   * local configuration.
   */
  workspaceKey: externalKeySchema,
  agentKey: externalKeySchema,
  task: z.string().max(8192).nullish(),
  timeoutMs: z.number().int().min(1000).max(3_600_000),
  cancelGraceMs: z.number().int().min(0).max(600_000),
});

export const runCancelPayloadSchema = z.object({
  runId: z.string().max(64),
  graceMs: z.number().int().min(0).max(600_000),
  reason: z.enum(["user_requested", "timeout", "reconciliation"]).default("user_requested"),
});

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

const envelopeBase = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  messageId: z.string().min(1).max(64),
  timestamp: isoTimestampSchema,
};

export const nodeToServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...envelopeBase, type: z.literal("node.hello"), payload: nodeHelloPayloadSchema }),
  z.object({
    ...envelopeBase,
    type: z.literal("node.heartbeat"),
    payload: nodeHeartbeatPayloadSchema,
  }),
  z.object({ ...envelopeBase, type: z.literal("run.accepted"), payload: runAcceptedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("run.started"), payload: runStartedPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("run.event"), payload: runEventPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("run.finished"), payload: runFinishedPayloadSchema }),
]);
export type NodeToServerMessage = z.infer<typeof nodeToServerMessageSchema>;

export const serverToNodeMessageSchema = z.discriminatedUnion("type", [
  z.object({
    ...envelopeBase,
    type: z.literal("server.hello_ok"),
    payload: serverHelloOkPayloadSchema,
  }),
  z.object({
    ...envelopeBase,
    type: z.literal("server.error"),
    payload: serverErrorPayloadSchema,
  }),
  z.object({ ...envelopeBase, type: z.literal("run.dispatch"), payload: runDispatchPayloadSchema }),
  z.object({ ...envelopeBase, type: z.literal("run.cancel"), payload: runCancelPayloadSchema }),
]);
export type ServerToNodeMessage = z.infer<typeof serverToNodeMessageSchema>;

export type NodeMessageType = NodeToServerMessage["type"];
export type ServerMessageType = ServerToNodeMessage["type"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PayloadOf<M extends { type: string; payload: unknown }, T extends M["type"]> = Extract<
  M,
  { type: T }
>["payload"];

export function createNodeMessage<T extends NodeMessageType>(
  type: T,
  payload: PayloadOf<NodeToServerMessage, T>,
): Extract<NodeToServerMessage, { type: T }> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messageId: newId("msg"),
    timestamp: new Date().toISOString(),
    type,
    payload,
  } as Extract<NodeToServerMessage, { type: T }>;
}

export function createServerMessage<T extends ServerMessageType>(
  type: T,
  payload: PayloadOf<ServerToNodeMessage, T>,
): Extract<ServerToNodeMessage, { type: T }> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messageId: newId("msg"),
    timestamp: new Date().toISOString(),
    type,
    payload,
  } as Extract<ServerToNodeMessage, { type: T }>;
}

export interface ParseResult<T> {
  ok: boolean;
  message?: T;
  error?: string;
}

function parseRaw(
  raw: string | Buffer,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const size = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.length;
  if (size > MAX_WS_MESSAGE_BYTES) {
    return { ok: false, error: `message exceeds ${MAX_WS_MESSAGE_BYTES} bytes` };
  }
  try {
    return { ok: true, value: JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) };
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
}

export function parseNodeToServerMessage(raw: string | Buffer): ParseResult<NodeToServerMessage> {
  const parsed = parseRaw(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const result = nodeToServerMessageSchema.safeParse(parsed.value);
  if (!result.success) {
    return { ok: false, error: summarizeZodError(result.error) };
  }
  return { ok: true, message: result.data };
}

export function parseServerToNodeMessage(raw: string | Buffer): ParseResult<ServerToNodeMessage> {
  const parsed = parseRaw(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const result = serverToNodeMessageSchema.safeParse(parsed.value);
  if (!result.success) {
    return { ok: false, error: summarizeZodError(result.error) };
  }
  return { ok: true, message: result.data };
}

export function serializeMessage(message: NodeToServerMessage | ServerToNodeMessage): string {
  return JSON.stringify(message);
}

function summarizeZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
