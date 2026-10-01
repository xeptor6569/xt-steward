/**
 * API DTO types mirrored from the server's OpenAPI-documented responses.
 * Deliberately duplicated instead of importing server packages: the shared
 * backend packages pull in Node-only dependencies (pino, drizzle) that must
 * never enter the browser bundle.
 */

export type RunStatus =
  | "queued"
  | "dispatching"
  | "running"
  | "succeeded"
  | "failed"
  | "cancellation_requested"
  | "cancelled"
  | "timed_out"
  | "lost";

export const TERMINAL_RUN_STATUSES: RunStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "lost",
];

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export interface UserDto {
  id: string;
  displayName: string;
  email: string | null;
  role: "admin" | "member";
  createdAt: string;
}

export interface NodeDto {
  id: string;
  name: string;
  status: "online" | "offline";
  version: string | null;
  labels: Record<string, string>;
  capabilities: Record<string, string | number | boolean>;
  lastConnectedAt: string | null;
  lastHeartbeatAt: string | null;
  maxConcurrentRuns: number;
  activeRunCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDto {
  id: string;
  nodeId: string;
  nodeName: string | null;
  nodeStatus: "online" | "offline" | null;
  externalKey: string;
  name: string;
  localPath: string;
  repositoryUrl: string | null;
  defaultBranch: string | null;
  readOnly: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDto {
  id: string;
  nodeId: string;
  externalKey: string;
  type: "diagnostic";
  name: string;
  version: string | null;
  enabled: boolean;
  capabilities: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface RunDto {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  nodeId: string;
  nodeName: string | null;
  agentDefinitionId: string | null;
  type: "diagnostic";
  status: RunStatus;
  requestedByUserId: string;
  task: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  cancellationRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunEventDto {
  id: string;
  runId: string;
  sequence: number;
  type: "log" | "notice" | "state";
  stream: "stdout" | "stderr" | null;
  message: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface EnrollmentTokenDto {
  id: string;
  name: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface RunDetailsDto {
  run: RunDto;
  node: NodeDto | null;
  workspace: WorkspaceDto | null;
  agent: AgentDto | null;
}

export interface NodeDetailsDto {
  node: NodeDto;
  workspaces: WorkspaceDto[];
  agents: AgentDto[];
  recentRuns: RunDto[];
}
