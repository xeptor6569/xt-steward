import type {
  agentDefinitions,
  nodeEnrollmentTokens,
  nodes,
  runEvents,
  runs,
  users,
  workspaces,
} from "@steward/database";
import { RUN_STATUSES } from "@steward/shared";
import { z } from "zod";

const isoDate = z.string();
const isoDateNullable = z.string().nullable();

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});

export const userDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  role: z.enum(["admin", "member"]),
  createdAt: isoDate,
});
export type UserDto = z.infer<typeof userDtoSchema>;

export function toUserDto(row: typeof users.$inferSelect): UserDto {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}

export const nodeDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["online", "offline"]),
  version: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  capabilities: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  lastConnectedAt: isoDateNullable,
  lastHeartbeatAt: isoDateNullable,
  maxConcurrentRuns: z.number().int(),
  activeRunCount: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type NodeDto = z.infer<typeof nodeDtoSchema>;

export function toNodeDto(row: typeof nodes.$inferSelect, activeRunCount = 0): NodeDto {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    version: row.version,
    labels: row.labels,
    capabilities: row.capabilities,
    lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    maxConcurrentRuns: row.maxConcurrentRuns,
    activeRunCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const workspaceDtoSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  nodeName: z.string().nullable(),
  nodeStatus: z.enum(["online", "offline"]).nullable(),
  externalKey: z.string(),
  name: z.string(),
  localPath: z.string(),
  repositoryUrl: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  readOnly: z.boolean(),
  enabled: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type WorkspaceDto = z.infer<typeof workspaceDtoSchema>;

export function toWorkspaceDto(
  row: typeof workspaces.$inferSelect,
  node?: { name: string; status: "online" | "offline" } | null,
): WorkspaceDto {
  return {
    id: row.id,
    nodeId: row.nodeId,
    nodeName: node?.name ?? null,
    nodeStatus: node?.status ?? null,
    externalKey: row.externalKey,
    name: row.name,
    localPath: row.localPath,
    repositoryUrl: row.repositoryUrl,
    defaultBranch: row.defaultBranch,
    readOnly: row.readOnly,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const agentDtoSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  externalKey: z.string(),
  type: z.enum(["diagnostic"]),
  name: z.string(),
  version: z.string().nullable(),
  enabled: z.boolean(),
  capabilities: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type AgentDto = z.infer<typeof agentDtoSchema>;

export function toAgentDto(row: typeof agentDefinitions.$inferSelect): AgentDto {
  return {
    id: row.id,
    nodeId: row.nodeId,
    externalKey: row.externalKey,
    type: row.type,
    name: row.name,
    version: row.version,
    enabled: row.enabled,
    capabilities: row.capabilities,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const runDtoSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string().nullable(),
  nodeId: z.string(),
  nodeName: z.string().nullable(),
  agentDefinitionId: z.string().nullable(),
  type: z.enum(["diagnostic"]),
  status: z.enum(RUN_STATUSES),
  requestedByUserId: z.string(),
  task: z.string().nullable(),
  queuedAt: isoDate,
  startedAt: isoDateNullable,
  finishedAt: isoDateNullable,
  exitCode: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  cancellationRequestedAt: isoDateNullable,
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type RunDto = z.infer<typeof runDtoSchema>;

export function toRunDto(
  row: typeof runs.$inferSelect,
  names: { workspaceName?: string | null; nodeName?: string | null } = {},
): RunDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceName: names.workspaceName ?? null,
    nodeId: row.nodeId,
    nodeName: names.nodeName ?? null,
    agentDefinitionId: row.agentDefinitionId,
    type: row.type,
    status: row.status,
    requestedByUserId: row.requestedByUserId,
    task: row.task,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    exitCode: row.exitCode,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    cancellationRequestedAt: row.cancellationRequestedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const runEventDtoSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sequence: z.number().int(),
  type: z.enum(["log", "notice", "state"]),
  stream: z.enum(["stdout", "stderr"]).nullable(),
  message: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: isoDate,
});
export type RunEventDto = z.infer<typeof runEventDtoSchema>;

export function toRunEventDto(row: typeof runEvents.$inferSelect): RunEventDto {
  return {
    id: row.id,
    runId: row.runId,
    sequence: row.sequence,
    type: row.type,
    stream: row.stream,
    message: row.message,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

export const enrollmentTokenDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  expiresAt: isoDate,
  usedAt: isoDateNullable,
  revokedAt: isoDateNullable,
  createdByUserId: z.string(),
  createdAt: isoDate,
});
export type EnrollmentTokenDto = z.infer<typeof enrollmentTokenDtoSchema>;

export function toEnrollmentTokenDto(
  row: typeof nodeEnrollmentTokens.$inferSelect,
): EnrollmentTokenDto {
  return {
    id: row.id,
    name: row.name,
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}
