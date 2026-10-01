import { statSync } from "node:fs";
import os from "node:os";
import { abortableSleep, abortError, spawnCollect } from "./spawn.js";
import type { AgentAdapter, AgentResult, AgentRunContext } from "./types.js";

const COMMAND_TIMEOUT_MS = 10_000;
/** Testing affordance: `task: "delay=8"` sleeps 8s mid-run (max 300). */
const DELAY_TASK_PATTERN = /^delay=(\d{1,3})$/;

/**
 * Built-in diagnostic agent. Collects safe, read-only information about the
 * node and the workspace to prove distributed execution end to end. It never
 * accepts arbitrary commands: every spawned process is a fixed executable
 * with a fixed argument array and `shell: false`.
 */
export class DiagnosticAgent implements AgentAdapter {
  readonly type = "diagnostic" as const;
  readonly name = "Built-in Diagnostic Agent";

  async execute(ctx: AgentRunContext): Promise<AgentResult> {
    const startedAt = new Date().toISOString();
    ctx.emit({
      type: "notice",
      message: `Diagnostic run started on node "${ctx.nodeName}" in workspace "${ctx.workspace.name}"`,
      metadata: { startedAt },
    });

    try {
      statSync(ctx.workspace.path);
    } catch {
      return {
        result: "failed",
        errorCode: "workspace_unavailable",
        errorMessage: `workspace path is not accessible`,
      };
    }

    const say = (message: string) => ctx.emit({ type: "log", stream: "stdout", message });

    say(`node.name: ${ctx.nodeName}`);
    say(`os.platform: ${os.platform()}`);
    say(`os.release: ${os.release()}`);
    say(`os.arch: ${os.arch()}`);
    say(`runtime.node: ${process.version}`);
    say(`workspace.key: ${ctx.workspace.key}`);
    say(`workspace.name: ${ctx.workspace.name}`);
    say(`workspace.readOnly: ${ctx.workspace.readOnly}`);

    this.throwIfAborted(ctx);
    const git = await this.collectGit(ctx);
    if (!git) {
      ctx.emit({
        type: "notice",
        message: "git is not installed on this node; skipping repository checks",
      });
    }

    const delay = this.requestedDelayMs(ctx.task);
    if (delay > 0) {
      ctx.emit({
        type: "notice",
        message: `Simulating a long diagnostic: sleeping ${delay / 1000}s`,
      });
      await abortableSleep(delay, ctx.signal);
    }

    this.throwIfAborted(ctx);
    const finishedAt = new Date().toISOString();
    ctx.emit({
      type: "notice",
      message: "Diagnostic run finished",
      metadata: { startedAt, finishedAt },
    });
    return { result: "succeeded", exitCode: 0 };
  }

  private requestedDelayMs(task: string | null): number {
    if (!task) return 0;
    const match = DELAY_TASK_PATTERN.exec(task.trim());
    if (!match) return 0;
    return Math.min(Number(match[1]), 300) * 1000;
  }

  private throwIfAborted(ctx: AgentRunContext): void {
    if (ctx.signal.aborted) throw abortError(ctx.signal);
  }

  /** Returns false when git is unavailable. */
  private async collectGit(ctx: AgentRunContext): Promise<boolean> {
    const run = (args: readonly string[]) =>
      spawnCollect("git", args, {
        cwd: ctx.workspace.path,
        timeoutMs: COMMAND_TIMEOUT_MS,
        signal: ctx.signal,
      });

    let version;
    try {
      version = await run(["--version"]);
    } catch {
      return false;
    }
    this.emitCommand(ctx, "git --version", version.stdout, version.stderr);

    const inside = await run(["rev-parse", "--is-inside-work-tree"]);
    const isRepo = inside.exitCode === 0 && inside.stdout.trim() === "true";
    ctx.emit({ type: "log", stream: "stdout", message: `workspace.gitRepository: ${isRepo}` });
    if (!isRepo) return true;

    const branch = await run(["rev-parse", "--abbrev-ref", "HEAD"]);
    this.emitCommand(ctx, "git rev-parse --abbrev-ref HEAD", branch.stdout, branch.stderr);

    const status = await run(["status", "--short"]);
    this.emitCommand(
      ctx,
      "git status --short",
      status.stdout.length > 0 ? status.stdout : "(clean)",
      status.stderr,
    );
    return true;
  }

  private emitCommand(ctx: AgentRunContext, label: string, stdout: string, stderr: string): void {
    ctx.emit({ type: "notice", message: `$ ${label}` });
    for (const line of stdout.split("\n")) {
      if (line.trim().length > 0) ctx.emit({ type: "log", stream: "stdout", message: line });
    }
    for (const line of stderr.split("\n")) {
      if (line.trim().length > 0) ctx.emit({ type: "log", stream: "stderr", message: line });
    }
  }
}
