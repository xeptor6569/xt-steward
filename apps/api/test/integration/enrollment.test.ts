import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAdminAndLogin,
  resetState,
  startControlPlane,
  TestClient,
  type ControlPlane,
} from "./harness.js";

describe("node enrollment tokens and enrollment", () => {
  let cp: ControlPlane;
  let admin: TestClient;

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

  async function createToken(name = "test token"): Promise<{ id: string; plaintext: string }> {
    const response = await admin.post("/api/v1/node-enrollment-tokens", { name });
    expect(response.status).toBe(201);
    return { id: response.body.token.id, plaintext: response.body.token.plaintext };
  }

  it("returns the plaintext exactly once and never lists it", async () => {
    const { plaintext } = await createToken();
    expect(plaintext).toMatch(/^stx_enroll_/);

    const list = await admin.get("/api/v1/node-enrollment-tokens");
    expect(list.status).toBe(200);
    expect(list.body.tokens).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(plaintext);
    expect(JSON.stringify(list.body)).not.toContain("tokenHash");
  });

  it("requires an authenticated admin to manage tokens", async () => {
    const anonymous = new TestClient(cp.baseUrl);
    const response = await anonymous.post("/api/v1/node-enrollment-tokens", { name: "nope" });
    expect(response.status).toBe(401);
  });

  it("enrolls a node and burns the token atomically", async () => {
    const { plaintext } = await createToken();

    const enroll = await fetch(`${cp.baseUrl}/api/v1/nodes/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: plaintext, name: "enroll-test-01" }),
    });
    expect(enroll.status).toBe(201);
    const body = (await enroll.json()) as { nodeId: string; credential: string };
    expect(body.nodeId).toMatch(/^node_/);
    expect(body.credential).toMatch(/^stx_node_/);

    // Single use: a second exchange with the same token must fail.
    const replay = await fetch(`${cp.baseUrl}/api/v1/nodes/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: plaintext, name: "enroll-test-02" }),
    });
    expect(replay.status).toBe(401);

    const nodes = await admin.get("/api/v1/nodes");
    expect(nodes.body.nodes).toHaveLength(1);
    expect(nodes.body.nodes[0]).toMatchObject({ name: "enroll-test-01", status: "offline" });
  });

  it("rejects revoked tokens", async () => {
    const { id, plaintext } = await createToken();
    const revoke = await admin.delete(`/api/v1/node-enrollment-tokens/${id}`);
    expect(revoke.status).toBe(204);

    const enroll = await fetch(`${cp.baseUrl}/api/v1/nodes/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: plaintext, name: "revoked-test" }),
    });
    expect(enroll.status).toBe(401);
  });

  it("rolls back the token burn when the node name is already taken", async () => {
    const first = await createToken();
    const ok = await fetch(`${cp.baseUrl}/api/v1/nodes/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: first.plaintext, name: "duplicate-name" }),
    });
    expect(ok.status).toBe(201);

    const second = await createToken("second token");
    const conflict = await fetch(`${cp.baseUrl}/api/v1/nodes/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: second.plaintext, name: "duplicate-name" }),
    });
    expect(conflict.status).toBe(409);

    // The conflicting attempt must not have consumed the token.
    const retry = await fetch(`${cp.baseUrl}/api/v1/nodes/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: second.plaintext, name: "unique-name" }),
    });
    expect(retry.status).toBe(201);
  });
});
