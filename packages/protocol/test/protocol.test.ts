import { describe, expect, it } from "vitest";
import {
  createNodeMessage,
  createServerMessage,
  externalKeySchema,
  MAX_WS_MESSAGE_BYTES,
  parseNodeToServerMessage,
  parseServerToNodeMessage,
  PROTOCOL_VERSION,
  serializeMessage,
} from "../src/index.js";

const helloPayload = {
  nodeName: "home-server-01",
  nodeVersion: "0.1.0",
  os: { platform: "linux", release: "6.8.0", arch: "x64" },
  runtime: { node: "v22.14.0" },
  labels: { region: "home" },
  capabilities: { cpus: 8 },
  maxConcurrentRuns: 2,
  workspaces: [
    {
      key: "steward",
      name: "Steward XT",
      localPath: "/srv/projects/xt-steward",
      readOnly: false,
    },
  ],
  agents: [
    {
      key: "diagnostic",
      type: "diagnostic" as const,
      name: "Built-in Diagnostic Agent",
      enabled: true,
      capabilities: {},
    },
  ],
  activeRunIds: [],
};

describe("envelope helpers", () => {
  it("stamps protocol version, message id, and timestamp", () => {
    const msg = createNodeMessage("node.hello", helloPayload);
    expect(msg.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(msg.messageId).toMatch(/^msg_[0-9a-f]{32}$/);
    expect(new Date(msg.timestamp).getTime()).not.toBeNaN();
  });

  it("round-trips node messages through serialize/parse", () => {
    const msg = createNodeMessage("run.event", {
      runId: "run_abc",
      sequence: 7,
      eventType: "log",
      stream: "stdout",
      message: "hello",
      occurredAt: new Date().toISOString(),
    });
    const parsed = parseNodeToServerMessage(serializeMessage(msg));
    expect(parsed.ok).toBe(true);
    expect(parsed.message).toEqual(msg);
  });

  it("round-trips server messages through serialize/parse", () => {
    const msg = createServerMessage("run.dispatch", {
      runId: "run_abc",
      runType: "diagnostic",
      workspaceKey: "steward",
      agentKey: "diagnostic",
      task: null,
      timeoutMs: 120_000,
      cancelGraceMs: 5000,
    });
    const parsed = parseServerToNodeMessage(serializeMessage(msg));
    expect(parsed.ok).toBe(true);
    expect(parsed.message).toEqual(msg);
  });
});

describe("validation", () => {
  it("rejects an unknown protocol version", () => {
    const msg = {
      ...createNodeMessage("node.heartbeat", { activeRunIds: [] }),
      protocolVersion: 2,
    };
    const parsed = parseNodeToServerMessage(JSON.stringify(msg));
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("protocolVersion");
  });

  it("rejects unknown message types", () => {
    const msg = { ...createNodeMessage("node.heartbeat", { activeRunIds: [] }), type: "node.evil" };
    expect(parseNodeToServerMessage(JSON.stringify(msg)).ok).toBe(false);
  });

  it("rejects invalid JSON and oversized frames", () => {
    expect(parseNodeToServerMessage("{not json").ok).toBe(false);
    const huge = Buffer.alloc(MAX_WS_MESSAGE_BYTES + 1, 0x61);
    const parsed = parseNodeToServerMessage(huge);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("exceeds");
  });

  it("rejects dispatch payloads carrying filesystem paths as workspace keys", () => {
    for (const bad of ["/srv/projects", "../escape", "a/b", "UPPER", ".hidden", ""]) {
      expect(externalKeySchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(externalKeySchema.safeParse("steward-xt_01").success).toBe(true);
  });

  it("rejects a dispatch with a non-advertisable path payload", () => {
    const msg = createServerMessage("run.cancel", {
      runId: "run_x",
      graceMs: 1000,
      reason: "timeout",
    });
    const tampered = JSON.parse(serializeMessage(msg)) as Record<string, unknown>;
    tampered.payload = { runId: "run_x", graceMs: -5 };
    expect(parseServerToNodeMessage(JSON.stringify(tampered)).ok).toBe(false);
  });

  it("rejects run events without a positive sequence", () => {
    const msg = createNodeMessage("run.event", {
      runId: "run_abc",
      sequence: 1,
      eventType: "notice",
      occurredAt: new Date().toISOString(),
    });
    const tampered = JSON.parse(serializeMessage(msg)) as { payload: { sequence: number } };
    tampered.payload.sequence = 0;
    expect(parseNodeToServerMessage(JSON.stringify(tampered)).ok).toBe(false);
  });
});
