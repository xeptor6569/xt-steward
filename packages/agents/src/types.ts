/**
 * Agent adapter contract. An adapter executes one run inside an approved
 * workspace on the node. Adapters never receive raw control-plane input other
 * than the optional `task` string, never spawn shells, and report output
 * exclusively through `emit` so the node runtime can apply sequencing,
 * redaction, and size limits uniformly.
 */

export interface AgentWorkspaceInfo {
  key: string;
  name: string;
  /** Canonical absolute path validated by the node runtime. */
  path: string;
  readOnly: boolean;
}

export type AgentEmittedEvent =
  | { type: "log"; stream: "stdout" | "stderr"; message: string }
  | { type: "notice"; message: string; metadata?: Record<string, unknown> };

export interface AgentRunContext {
  runId: string;
  task: string | null;
  workspace: AgentWorkspaceInfo;
  nodeName: string;
  timeoutMs: number;
  /**
   * Aborted when the run is cancelled or times out. `signal.reason` is
   * "cancelled" or "timed_out". Adapters must stop promptly when it fires;
   * the runtime force-kills spawned processes after the grace period.
   */
  signal: AbortSignal;
  emit: (event: AgentEmittedEvent) => void;
}

export interface AgentResult {
  result: "succeeded" | "failed";
  exitCode?: number | null;
  errorCode?: string;
  errorMessage?: string;
}

export interface AgentAdapter {
  readonly type: "diagnostic";
  readonly name: string;
  execute(ctx: AgentRunContext): Promise<AgentResult>;
}
