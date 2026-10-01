import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAdminAndLogin,
  resetState,
  startControlPlane,
  TestClient,
  type ControlPlane,
} from "./harness.js";

describe("setup and authentication", () => {
  let cp: ControlPlane;

  beforeAll(async () => {
    cp = await startControlPlane();
  });

  afterAll(async () => {
    await cp.stop();
  });

  beforeEach(async () => {
    await resetState(cp);
  });

  it("reports needsSetup until the first administrator exists", async () => {
    const client = new TestClient(cp.baseUrl);

    const before = await client.get("/api/v1/setup/status");
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ needsSetup: true });

    await createAdminAndLogin(client);

    const after = await client.get("/api/v1/setup/status");
    expect(after.body).toEqual({ needsSetup: false });
  });

  it("logs the administrator in immediately after setup", async () => {
    const client = new TestClient(cp.baseUrl);
    await createAdminAndLogin(client, { email: "root@steward.test" });

    const session = await client.get("/api/v1/auth/session");
    expect(session.status).toBe(200);
    expect(session.body.user).toMatchObject({ email: "root@steward.test", role: "admin" });
  });

  it("rejects a second setup attempt once an administrator exists", async () => {
    const first = new TestClient(cp.baseUrl);
    await createAdminAndLogin(first);

    const second = new TestClient(cp.baseUrl);
    const response = await second.post("/api/v1/setup", {
      displayName: "Interloper",
      email: "interloper@steward.test",
      password: "not-the-first-admin",
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("setup_already_complete");
  });

  it("rejects state-changing requests without the CSRF header", async () => {
    const client = new TestClient(cp.baseUrl);
    await client.get("/api/v1/setup/status"); // obtain the CSRF cookie

    const response = await fetch(`${cp.baseUrl}/api/v1/setup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `stx_csrf=${client.cookie("stx_csrf")}`,
        // deliberately no x-steward-csrf header
      },
      body: JSON.stringify({
        displayName: "CSRF Victim",
        email: "victim@steward.test",
        password: "should-never-be-created",
      }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("csrf_failed");
  });

  it("logs in with valid credentials and rejects invalid ones", async () => {
    const setupClient = new TestClient(cp.baseUrl);
    await createAdminAndLogin(setupClient, {
      email: "login@steward.test",
      password: "a-long-valid-password",
    });

    const client = new TestClient(cp.baseUrl);
    const bad = await client.post("/api/v1/auth/login", {
      email: "login@steward.test",
      password: "wrong-password-entirely",
    });
    expect(bad.status).toBe(401);
    expect(client.cookie("stx_session")).toBeUndefined();

    const unknown = await client.post("/api/v1/auth/login", {
      email: "nobody@steward.test",
      password: "wrong-password-entirely",
    });
    expect(unknown.status).toBe(401);

    const good = await client.post("/api/v1/auth/login", {
      email: "login@steward.test",
      password: "a-long-valid-password",
    });
    expect(good.status).toBe(200);
    expect(client.cookie("stx_session")).toBeDefined();

    const session = await client.get("/api/v1/auth/session");
    expect(session.body.user.email).toBe("login@steward.test");
  });

  it("destroys the session on logout", async () => {
    const client = new TestClient(cp.baseUrl);
    await createAdminAndLogin(client);
    const sessionToken = client.cookie("stx_session");
    expect(sessionToken).toBeDefined();

    const logout = await client.post("/api/v1/auth/logout");
    expect(logout.status).toBe(204);

    // Even replaying the old token must fail: the session row is gone.
    const replay = await fetch(`${cp.baseUrl}/api/v1/nodes`, {
      headers: { cookie: `stx_session=${sessionToken}` },
    });
    expect(replay.status).toBe(401);
  });

  it("requires authentication for the protected API surface", async () => {
    const client = new TestClient(cp.baseUrl);
    for (const pathname of ["/api/v1/nodes", "/api/v1/workspaces", "/api/v1/runs"]) {
      const response = await client.get(pathname);
      expect(response.status, pathname).toBe(401);
    }
    const create = await client.post("/api/v1/runs", { workspaceId: "ws_nope" });
    expect(create.status).toBe(401);
  });
});
