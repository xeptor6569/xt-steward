import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NodeToServerMessage } from "@steward/protocol";
import { createLogger, createRedactor } from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ValidatedConfig } from "../src/config.js";
import { RunManager } from "../src/runner.js";

let workspaceDir: string;

beforeAll(() => {
  workspaceDir = mkdtempSync(path.join(os.tmpdir(), "steward-runner-"));
});

afterAll(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
});

const silentLog = createLogger({ service: "test", level: "fatal" });

function makeValidated(): ValidatedConfig {
  return {
    config: {
      serverUrl: "https://steward.example.com",
      nodeName: "test-node",
      workspaces: [{ key: "fixture", name: "Fixture", path: workspaceDir, readOnly: false }],
      agents: [
        { key: "diagnostic", type: "diagnostic", name: "Diagnostic", enabled: true },
        { key: "disabled-agent", type: "diagnostic", name: "Disabled", enabled: false },
      ],
      maxConcurrentRuns: 1,
      logLevel: "info",
      allowInsecureHttp: false,
      redactValues: [],
    },
    workspaces: [
      {
        key: "fixture",
        name: "Fixture",
        configuredPath: workspaceDir,
        canonicalPath: workspaceDir,
        readOnly: false,
        repositoryUrl: null,
        defaultBranch: null,
      },
    ],
    workspaceErrors: [],
  };
}

function makeManager(secrets: string[] = []) {
  const sent: NodeToServerMessage[] = [];
  const manager = new RunManager(
    makeValidated(),
    "test-node",
    1,
    createRedactor(secrets),
    (message) => sent.push(message),
    silentLog,
  );
  return { manager, sent };
}

function dispatchPayload(runId: string, overrides: Record<string, unknown> = {}) {
  return {
    runId,
    runType: "diagnostic" as const,
    workspaceKey: "fixture",
    agentKey: "diagnostic",
    task: null,
    timeoutMs: 30_000,
    cancelGraceMs: 500,
    ...overrides,
  };
}

async function waitForFinish(sent: NodeToServerMessage[], runId: string, timeoutMs = 15_000) {
  await vi.waitFor(
    () => {
      const finished = sent.find((m) => m.type === "run.finished" && m.payload.runId === runId);
      expect(finished).toBeDefined();
    },
    { timeout: timeoutMs, interval: 50 },
  );
  return sent.find(
    (m): m is Extract<NodeToServerMessage, { type: "run.finished" }> =>
      m.type === "run.finished" && m.payload.runId === runId,
  )!;
}

describe("RunManager", () => {
  it("rejects unknown workspace keys (control plane can never name a path)", () => {
    const { manager, sent } = makeManager();
    manager.handleDispatch(dispatchPayload("run_1", { workspaceKey: "not-configured" }));
    const ack = sent.find((m) => m.type === "run.accepted");
    expect(ack?.payload).toMatchObject({ accepted: false });
    expect((ack?.payload as { reason?: string }).reason).toContain("not configured");
  });

  it("rejects disabled or unknown agents", () => {
    const { manager, sent } = makeManager();
    manager.handleDispatch(dispatchPayload("run_2", { agentKey: "disabled-agent" }));
    expect(sent.find((m) => m.type === "run.accepted")?.payload).toMatchObject({
      accepted: false,
    });
  });

  it("executes a diagnostic run to completion with started/events/finished", async () => {
    const { manager, sent } = makeManager();
    manager.handleDispatch(dispatchPayload("run_3"));
    const finished = await waitForFinish(sent, "run_3");
    expect(finished.payload.result).toBe("succeeded");
    expect(sent.some((m) => m.type === "run.started")).toBe(true);
    const events = sent.filter((m) => m.type === "run.event");
    expect(events.length).toBeGreaterThan(3);
    // Node-assigned sequences are strictly increasing from 1.
    const sequences = events.map((m) => (m.payload as { sequence: number }).sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(sequences[0]).toBe(1);
  });

  it("does not start a duplicate dispatch twice but re-acks it", async () => {
    const { manager, sent } = makeManager();
    manager.handleDispatch(dispatchPayload("run_4", { task: "delay=2" }));
    manager.handleDispatch(dispatchPayload("run_4", { task: "delay=2" }));
    manager.handleCancel({ runId: "run_4", graceMs: 100, reason: "user_requested" });
    await waitForFinish(sent, "run_4");
    const started = sent.filter((m) => m.type === "run.started");
    expect(started).toHaveLength(1);
    const acks = sent.filter((m) => m.type === "run.accepted");
    expect(acks).toHaveLength(2);
    expect(acks.every((a) => (a.payload as { accepted: boolean }).accepted)).toBe(true);
  });

  it("rejects dispatches beyond capacity", async () => {
    const { manager, sent } = makeManager();
    manager.handleDispatch(dispatchPayload("run_5", { task: "delay=5" }));
    manager.handleDispatch(dispatchPayload("run_6"));
    const rejection = sent.find((m) => m.type === "run.accepted" && m.payload.runId === "run_6");
    expect(rejection?.payload).toMatchObject({ accepted: false });
    expect((rejection?.payload as { reason?: string }).reason).toContain("capacity");
    manager.handleCancel({ runId: "run_5", graceMs: 100, reason: "user_requested" });
    await waitForFinish(sent, "run_5");
  });

  it("cancels an in-flight run and reports cancelled", async () => {
    const { manager, sent } = makeManager();
    manager.handleDispatch(dispatchPayload("run_7", { task: "delay=30" }));
    await vi.waitFor(() => {
      expect(sent.some((m) => m.type === "run.started")).toBe(true);
    });
    manager.handleCancel({ runId: "run_7", graceMs: 200, reason: "user_requested" });
    const finished = await waitForFinish(sent, "run_7");
    expect(finished.payload.result).toBe("cancelled");
    expect(manager.activeRunIds()).toEqual([]);
  });

  it("treats cancel as idempotent (unknown or already finished runs)", () => {
    const { manager } = makeManager();
    expect(() =>
      manager.handleCancel({ runId: "run_never", graceMs: 100, reason: "user_requested" }),
    ).not.toThrow();
  });

  it("reports timed_out when the dispatch timeout elapses", async () => {
    const { manager, sent } = makeManager();
    manager.handleDispatch(dispatchPayload("run_8", { task: "delay=30", timeoutMs: 1200 }));
    const finished = await waitForFinish(sent, "run_8");
    expect(finished.payload.result).toBe("timed_out");
  });

  it("redacts configured secrets from emitted events", async () => {
    const secret = "stx_node_super_secret_value_123";
    const { manager, sent } = makeManager([secret, "test-node"]);
    manager.handleDispatch(dispatchPayload("run_9"));
    await waitForFinish(sent, "run_9");
    const text = sent
      .filter((m) => m.type === "run.event")
      .map((m) => (m.payload as { message?: string }).message ?? "")
      .join("\n");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("test-node"); // node name itself redacted per config
    expect(text).toContain("[REDACTED]");
  });
});
