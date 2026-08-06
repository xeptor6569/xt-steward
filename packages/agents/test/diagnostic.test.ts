import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DiagnosticAgent } from "../src/diagnostic.js";
import { isAbortError } from "../src/spawn.js";
import type { AgentEmittedEvent, AgentRunContext } from "../src/types.js";

let workspaceDir: string;

beforeAll(() => {
  workspaceDir = mkdtempSync(path.join(os.tmpdir(), "steward-diag-"));
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: workspaceDir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: workspaceDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: workspaceDir });
  writeFileSync(path.join(workspaceDir, "README.md"), "# fixture\n");
  execFileSync("git", ["add", "."], { cwd: workspaceDir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: workspaceDir });
});

afterAll(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
});

function makeContext(overrides: Partial<AgentRunContext> = {}): {
  ctx: AgentRunContext;
  events: AgentEmittedEvent[];
} {
  const events: AgentEmittedEvent[] = [];
  const ctx: AgentRunContext = {
    runId: "run_test",
    task: null,
    workspace: { key: "fixture", name: "Fixture", path: workspaceDir, readOnly: false },
    nodeName: "test-node",
    timeoutMs: 60_000,
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    ...overrides,
  };
  return { ctx, events };
}

describe("DiagnosticAgent", () => {
  it("succeeds and reports node, workspace, and git information", async () => {
    const { ctx, events } = makeContext();
    const result = await new DiagnosticAgent().execute(ctx);
    expect(result.result).toBe("succeeded");
    expect(result.exitCode).toBe(0);

    const text = events
      .map((e) => e.message)
      .filter((m): m is string => typeof m === "string")
      .join("\n");
    expect(text).toContain("node.name: test-node");
    expect(text).toContain(`os.platform: ${os.platform()}`);
    expect(text).toContain("workspace.gitRepository: true");
    expect(text).toContain("main");
    expect(text).toContain("git status --short");
  });

  it("fails with workspace_unavailable for a missing directory", async () => {
    const { ctx } = makeContext({
      workspace: {
        key: "gone",
        name: "Gone",
        path: path.join(workspaceDir, "missing"),
        readOnly: false,
      },
    });
    const result = await new DiagnosticAgent().execute(ctx);
    expect(result.result).toBe("failed");
    expect(result.errorCode).toBe("workspace_unavailable");
  });

  it("stops promptly when cancelled during a delay task", async () => {
    const controller = new AbortController();
    const { ctx } = makeContext({ task: "delay=60", signal: controller.signal });
    const started = Date.now();
    const execution = new DiagnosticAgent().execute(ctx);
    setTimeout(() => controller.abort("cancelled"), 300);
    await expect(execution).rejects.toSatisfy(isAbortError);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("ignores malformed delay tasks instead of executing them", async () => {
    const { ctx } = makeContext({ task: "delay=9999999; rm -rf /" });
    const result = await new DiagnosticAgent().execute(ctx);
    expect(result.result).toBe("succeeded");
  });
});
