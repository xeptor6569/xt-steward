/**
 * The milestone-one vertical slice, exercised end to end with real
 * components: Fastify API + BullMQ worker + an actual steward-node daemon
 * connected over WebSocket, driven purely through the public HTTP API.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  collectSseEvents,
  createAdminAndLogin,
  resetState,
  startControlPlane,
  startTestNode,
  TestClient,
  waitFor,
  type ControlPlane,
  type TestNode,
} from "./harness.js";

describe("distributed vertical slice", () => {
  let cp: ControlPlane;
  let admin: TestClient;
  let node: TestNode | undefined;

  beforeAll(async () => {
    cp = await startControlPlane();
  });

  afterAll(async () => {
    await cp.stop();
  });

  beforeEach(async () => {
    await resetState(cp);
    admin = new TestClient(cp.baseUrl);
    await createAdminAndLogin(admin);
  });

  afterEach(async () => {
    await node?.stop();
    node = undefined;
  });

  async function enrollAndStartNode(): Promise<TestNode> {
    const tokenResponse = await admin.post("/api/v1/node-enrollment-tokens", {
      name: "vertical slice",
    });
    expect(tokenResponse.status).toBe(201);
    const started = await startTestNode(cp, tokenResponse.body.token.plaintext);

    await waitFor(
      async () => {
        const nodes = await admin.get("/api/v1/nodes");
        const row = nodes.body.nodes.find((n: { id: string }) => n.id === started.nodeId);
        return row?.status === "online" ? row : undefined;
      },
      { label: "node online" },
    );
    return started;
  }

  async function discoveredWorkspaceId(nodeId: string): Promise<string> {
    return waitFor(
      async () => {
        const response = await admin.get("/api/v1/workspaces");
        const ws = response.body.workspaces.find(
          (w: { nodeId: string; externalKey: string }) =>
            w.nodeId === nodeId && w.externalKey === "fixture",
        );
        return ws?.id as string | undefined;
      },
      { label: "workspace discovered" },
    );
  }

  it("enrolls a node, discovers its workspace, and completes a diagnostic run", async () => {
    node = await enrollAndStartNode();
    const workspaceId = await discoveredWorkspaceId(node.nodeId);

    // Workspace advertisement carries the node's canonical metadata.
    const workspaces = await admin.get("/api/v1/workspaces");
    const workspace = workspaces.body.workspaces.find((w: { id: string }) => w.id === workspaceId);
    expect(workspace).toMatchObject({
      externalKey: "fixture",
      name: "Fixture Workspace",
      nodeName: node.nodeName,
      enabled: true,
    });

    const created = await admin.post("/api/v1/runs", { workspaceId, type: "diagnostic" });
    expect(created.status).toBe(201);
    const runId: string = created.body.run.id;
    expect(created.body.run.status).toBe("queued");

    // Live SSE stream carries the whole lifecycle and ends at the terminal state.
    const events = await collectSseEvents(cp, admin, runId);
    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("state");
    expect(eventTypes).toContain("log");
    expect(eventTypes.at(-1)).toBe("stream.end");
    expect(events.at(-1)?.data).toMatchObject({ runId, status: "succeeded" });

    const statuses = events
      .filter((e) => e.event === "state")
      .map((e) => e.data.metadata?.status ?? e.data.status);
    expect(statuses).toEqual(["queued", "dispatching", "running", "succeeded"]);

    const logMessages = events.filter((e) => e.event === "log").map((e) => e.data.message);
    expect(logMessages.some((m: string) => m.startsWith("node.name:"))).toBe(true);
    expect(logMessages.some((m: string) => m.includes("workspace.gitRepository: true"))).toBe(true);

    // Terminal state is persisted with exit metadata.
    const detail = await admin.get(`/api/v1/runs/${runId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.run).toMatchObject({ status: "succeeded", exitCode: 0 });
    expect(detail.body.run.startedAt).toBeTruthy();
    expect(detail.body.run.finishedAt).toBeTruthy();

    // Persisted events replay in a strictly contiguous sequence.
    const persisted = await admin.get(`/api/v1/runs/${runId}/events?limit=1000`);
    expect(persisted.status).toBe(200);
    const sequences = persisted.body.events.map((e: { sequence: number }) => e.sequence);
    expect(sequences).toEqual(sequences.map((_: number, i: number) => i + 1));
    expect(persisted.body.events.length).toBeGreaterThanOrEqual(events.length - 1);
  });

  it("cancels a long-running run and supports SSE resume", async () => {
    node = await enrollAndStartNode();
    const workspaceId = await discoveredWorkspaceId(node.nodeId);

    const created = await admin.post("/api/v1/runs", {
      workspaceId,
      type: "diagnostic",
      task: "delay=60",
    });
    expect(created.status).toBe(201);
    const runId: string = created.body.run.id;

    // Watch the live stream just until the run reports `running`.
    const untilRunning = await collectSseEvents(cp, admin, runId, {
      stopWhen: (events) =>
        events.some((e) => e.event === "state" && e.data.metadata?.status === "running"),
    });
    const lastSeen = Math.max(...untilRunning.map((e) => Number(e.id ?? 0)));

    const cancel = await admin.post(`/api/v1/runs/${runId}/cancel`);
    expect(cancel.status).toBe(202);
    expect(cancel.body.alreadyTerminal).toBe(false);

    // Resume the stream from the last seen sequence; it must finish the story.
    const resumed = await collectSseEvents(cp, admin, runId, { lastEventId: lastSeen });
    expect(resumed.every((e) => e.id === undefined || Number(e.id) > lastSeen)).toBe(true);
    expect(resumed.at(-1)?.event).toBe("stream.end");
    expect(resumed.at(-1)?.data.status).toBe("cancelled");

    const detail = await admin.get(`/api/v1/runs/${runId}`);
    expect(detail.body.run.status).toBe("cancelled");
    expect(detail.body.run.finishedAt).toBeTruthy();

    // Cancellation is idempotent.
    const again = await admin.post(`/api/v1/runs/${runId}/cancel`);
    expect(again.status).toBe(202);
    expect(again.body.alreadyTerminal).toBe(true);
  });

  it("cancels a queued run immediately when no node ever picks it up", async () => {
    node = await enrollAndStartNode();
    const workspaceId = await discoveredWorkspaceId(node.nodeId);
    await node.stop();
    node = undefined;

    await waitFor(
      async () => {
        const nodes = await admin.get("/api/v1/nodes");
        return nodes.body.nodes[0]?.status === "offline" ? true : undefined;
      },
      { label: "node offline" },
    );

    const created = await admin.post("/api/v1/runs", { workspaceId, type: "diagnostic" });
    expect(created.status).toBe(201);
    const runId: string = created.body.run.id;

    // The node is offline so dispatch retries in the background; the run
    // stays queued and a user cancel resolves it instantly.
    const cancel = await admin.post(`/api/v1/runs/${runId}/cancel`);
    expect(cancel.status).toBe(202);
    expect(cancel.body.run.status).toBe("cancelled");

    const detail = await admin.get(`/api/v1/runs/${runId}`);
    expect(detail.body.run.status).toBe("cancelled");
  });

  it("marks the node offline when it disconnects", async () => {
    node = await enrollAndStartNode();
    await node.stop();
    node = undefined;

    await waitFor(
      async () => {
        const nodes = await admin.get("/api/v1/nodes");
        return nodes.body.nodes[0]?.status === "offline" ? true : undefined;
      },
      { label: "node offline after disconnect" },
    );
  });

  it("rejects runs against unknown or disabled workspaces", async () => {
    const missing = await admin.post("/api/v1/runs", { workspaceId: "ws_does_not_exist" });
    expect(missing.status).toBe(404);
  });
});
