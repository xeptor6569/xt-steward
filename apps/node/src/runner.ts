import {
  createAgentRegistry,
  isAbortError,
  type AgentAdapter,
  type AgentEmittedEvent,
} from "@steward/agents";
import {
  createNodeMessage,
  type NodeToServerMessage,
  type ServerToNodeMessage,
} from "@steward/protocol";
import { truncateUtf8, type Logger, type Redactor } from "@steward/shared";
import type { ValidatedConfig, ValidatedWorkspace } from "./config.js";

type DispatchPayload = Extract<ServerToNodeMessage, { type: "run.dispatch" }>["payload"];
type CancelPayload = Extract<ServerToNodeMessage, { type: "run.cancel" }>["payload"];

const MAX_EVENT_MESSAGE_BYTES = 8 * 1024;
const MAX_EVENTS_PER_RUN = 5000;
const RECENT_RUN_MEMORY = 200;

interface ActiveRun {
  runId: string;
  controller: AbortController;
  workspaceKey: string;
  forceKillTimer?: NodeJS.Timeout;
}

/**
 * Executes dispatched runs on the node. Enforces the security boundary on the
 * node side: only workspace keys from the local validated configuration are
 * accepted, adapters are resolved from a fixed registry, all output is
 * redacted and size-capped, and cancellation aborts the process group with a
 * grace period before SIGKILL.
 */
export class RunManager {
  private readonly active = new Map<string, ActiveRun>();
  private readonly recentRunIds: string[] = [];
  private readonly registry: ReadonlyMap<string, AgentAdapter>;

  constructor(
    private validated: ValidatedConfig,
    private readonly nodeName: string,
    private readonly maxConcurrentRuns: number,
    private readonly redact: Redactor,
    private readonly send: (message: NodeToServerMessage) => void,
    private readonly log: Logger,
  ) {
    this.registry = createAgentRegistry();
  }

  activeRunIds(): string[] {
    return [...this.active.keys()];
  }

  updateConfig(validated: ValidatedConfig): void {
    // Only affects future dispatches; in-flight runs keep their resolved paths.
    this.validated = validated;
  }

  handleDispatch(payload: DispatchPayload): void {
    // Duplicate deliveries (redispatch after reconnect, worker re-publish) are
    // acknowledged but never started twice.
    if (this.active.has(payload.runId) || this.recentRunIds.includes(payload.runId)) {
      this.send(createNodeMessage("run.accepted", { runId: payload.runId, accepted: true }));
      return;
    }

    if (this.active.size >= this.maxConcurrentRuns) {
      this.send(
        createNodeMessage("run.accepted", {
          runId: payload.runId,
          accepted: false,
          reason: `node is at capacity (${this.maxConcurrentRuns} concurrent runs)`,
        }),
      );
      return;
    }

    const workspace = this.validated.workspaces.find((w) => w.key === payload.workspaceKey);
    if (!workspace) {
      this.send(
        createNodeMessage("run.accepted", {
          runId: payload.runId,
          accepted: false,
          reason: `workspace key "${payload.workspaceKey}" is not configured on this node`,
        }),
      );
      return;
    }

    const agentConfig = this.validated.config.agents.find(
      (a) => a.key === payload.agentKey && a.enabled,
    );
    const adapter = agentConfig ? this.registry.get(agentConfig.type) : undefined;
    if (!agentConfig || !adapter) {
      this.send(
        createNodeMessage("run.accepted", {
          runId: payload.runId,
          accepted: false,
          reason: `agent key "${payload.agentKey}" is not configured or enabled on this node`,
        }),
      );
      return;
    }

    this.send(createNodeMessage("run.accepted", { runId: payload.runId, accepted: true }));
    void this.execute(payload, workspace, adapter).catch((err: unknown) => {
      this.log.error({ err, runId: payload.runId }, "unexpected run execution error");
    });
  }

  handleCancel(payload: CancelPayload): void {
    const active = this.active.get(payload.runId);
    if (!active) {
      this.log.info({ runId: payload.runId }, "cancel for unknown/finished run (idempotent no-op)");
      return;
    }
    this.log.info({ runId: payload.runId, reason: payload.reason }, "cancelling run");
    active.controller.abort(payload.reason === "timeout" ? "timed_out" : "cancelled");
  }

  /** Cancels everything (used during shutdown). */
  cancelAll(reason: string): void {
    for (const run of this.active.values()) {
      run.controller.abort(reason);
    }
  }

  private async execute(
    payload: DispatchPayload,
    workspace: ValidatedWorkspace,
    adapter: AgentAdapter,
  ): Promise<void> {
    const controller = new AbortController();
    const activeRun: ActiveRun = {
      runId: payload.runId,
      controller,
      workspaceKey: workspace.key,
    };
    this.active.set(payload.runId, activeRun);

    const timeoutTimer = setTimeout(() => controller.abort("timed_out"), payload.timeoutMs);
    timeoutTimer.unref();

    let sequence = 0;
    let eventCount = 0;
    let outputSuppressed = false;

    const emit = (event: AgentEmittedEvent) => {
      eventCount += 1;
      if (eventCount > MAX_EVENTS_PER_RUN) {
        if (!outputSuppressed) {
          outputSuppressed = true;
          sequence += 1;
          this.send(
            createNodeMessage("run.event", {
              runId: payload.runId,
              sequence,
              eventType: "notice",
              message: `output limit reached (${MAX_EVENTS_PER_RUN} events); further output suppressed`,
              occurredAt: new Date().toISOString(),
            }),
          );
        }
        return;
      }
      const truncatedMessage = truncateUtf8(this.redact(event.message), MAX_EVENT_MESSAGE_BYTES);
      sequence += 1;
      this.send(
        createNodeMessage("run.event", {
          runId: payload.runId,
          sequence,
          eventType: event.type,
          stream: event.type === "log" ? event.stream : undefined,
          message: truncatedMessage.text,
          metadata: event.type === "notice" ? (event.metadata ?? {}) : undefined,
          occurredAt: new Date().toISOString(),
        }),
      );
    };

    this.send(
      createNodeMessage("run.started", {
        runId: payload.runId,
        startedAt: new Date().toISOString(),
      }),
    );

    try {
      const result = await adapter.execute({
        runId: payload.runId,
        task: payload.task ?? null,
        workspace: {
          key: workspace.key,
          name: workspace.name,
          path: workspace.canonicalPath,
          readOnly: workspace.readOnly,
        },
        nodeName: this.nodeName,
        timeoutMs: payload.timeoutMs,
        signal: controller.signal,
        emit,
      });

      if (controller.signal.aborted) {
        this.finish(payload.runId, this.abortResult(controller.signal));
      } else {
        this.finish(payload.runId, {
          result: result.result,
          exitCode: result.exitCode ?? null,
          errorCode: result.errorCode ?? null,
          errorMessage: result.errorMessage ? this.redact(result.errorMessage) : null,
        });
      }
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        this.finish(payload.runId, this.abortResult(controller.signal));
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.finish(payload.runId, {
          result: "failed",
          exitCode: null,
          errorCode: "agent_error",
          errorMessage: this.redact(message).slice(0, 4000),
        });
      }
    } finally {
      clearTimeout(timeoutTimer);
      this.active.delete(payload.runId);
      this.recentRunIds.push(payload.runId);
      if (this.recentRunIds.length > RECENT_RUN_MEMORY) this.recentRunIds.shift();
    }
  }

  private abortResult(signal: AbortSignal): {
    result: "cancelled" | "timed_out";
    exitCode: null;
    errorCode: string | null;
    errorMessage: string | null;
  } {
    const timedOut = signal.reason === "timed_out";
    return {
      result: timedOut ? "timed_out" : "cancelled",
      exitCode: null,
      errorCode: timedOut ? "run_timeout" : null,
      errorMessage: null,
    };
  }

  private finish(
    runId: string,
    outcome: {
      result: "succeeded" | "failed" | "cancelled" | "timed_out";
      exitCode: number | null;
      errorCode: string | null;
      errorMessage: string | null;
    },
  ): void {
    this.send(
      createNodeMessage("run.finished", {
        runId,
        result: outcome.result,
        exitCode: outcome.exitCode,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
        finishedAt: new Date().toISOString(),
      }),
    );
    this.log.info({ runId, result: outcome.result }, "run finished");
  }
}
