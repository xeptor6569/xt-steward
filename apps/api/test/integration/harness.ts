/**
 * Boots the real control plane (Fastify API + BullMQ worker) and, on demand,
 * a real steward-node daemon — the same code paths production uses. Tests
 * exercise the stack strictly through HTTP/WebSocket, never by poking
 * internals.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { enrollNode, NodeRuntime, type NodeConfig } from "@steward/node";
import { createLogger } from "@steward/shared";
import { createWorkerRuntime, loadWorkerEnv, type WorkerRuntime } from "@steward/worker";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { inject } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAppContext, type AppContext } from "../../src/context.js";
import { loadApiEnv } from "../../src/env.js";

export interface ControlPlane {
  ctx: AppContext;
  app: FastifyInstance;
  worker: WorkerRuntime;
  baseUrl: string;
  stop: () => Promise<void>;
}

const testLog = createLogger({ service: "steward-api-test", level: "fatal" });

/** Loose JSON type so assertions can drill into response bodies ergonomically. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate for test assertions
export type Json = any;

export async function startControlPlane(): Promise<ControlPlane> {
  const databaseUrl = inject("databaseUrl");
  const redisUrl = inject("redisUrl");

  const env = loadApiEnv({
    NODE_ENV: "test",
    STEWARD_DATABASE_URL: databaseUrl,
    STEWARD_REDIS_URL: redisUrl,
    STEWARD_LOG_LEVEL: "fatal",
    // High enough that test traffic never trips limits; rate limiting has
    // dedicated coverage elsewhere.
    STEWARD_RATE_LIMIT_MAX: "10000",
    STEWARD_AUTH_RATE_LIMIT_MAX: "1000",
    STEWARD_HEARTBEAT_INTERVAL_MS: "1000",
    STEWARD_NODE_OFFLINE_AFTER_MS: "5000",
    STEWARD_CANCEL_GRACE_MS: "2000",
  });
  const ctx = await createAppContext(env, testLog);
  const app = await buildApp(ctx);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("API server did not report a TCP address");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const worker = createWorkerRuntime(
    loadWorkerEnv({
      NODE_ENV: "test",
      STEWARD_DATABASE_URL: databaseUrl,
      STEWARD_REDIS_URL: redisUrl,
      STEWARD_LOG_LEVEL: "fatal",
      STEWARD_NODE_OFFLINE_AFTER_MS: "5000",
      STEWARD_CANCEL_GRACE_MS: "2000",
      STEWARD_MAINTENANCE_INTERVAL_MS: "600000", // manual via runMaintenanceOnce
    }),
    testLog,
  );
  await worker.start();

  return {
    ctx,
    app,
    worker,
    baseUrl,
    stop: async () => {
      await worker.stop();
      await app.close();
      await ctx.close();
    },
  };
}

/** Wipes every table and all Redis state so each test starts clean. */
export async function resetState(cp: ControlPlane): Promise<void> {
  await cp.ctx.db.execute(sql`
    truncate table
      audit_events, run_events, runs, agent_definitions, workspaces,
      node_enrollment_tokens, nodes, sessions, users
    restart identity cascade
  `);
  await cp.ctx.redis.flushdb();
}

/** Minimal browser stand-in: cookie jar plus automatic CSRF double-submit. */
export class TestClient {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  async request(
    method: string,
    pathname: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: Json; headers: Headers }> {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !this.cookies.has("stx_csrf")) {
      // First contact issues the CSRF cookie.
      await this.request("GET", "/api/v1/setup/status");
    }
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.cookies.size > 0) {
      headers["cookie"] = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    const csrf = this.cookies.get("stx_csrf");
    if (csrf && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      headers["x-steward-csrf"] = csrf;
    }
    if (body !== undefined) headers["content-type"] = "application/json";

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair] = setCookie.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (value === "" || setCookie.includes("Expires=Thu, 01 Jan 1970")) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed, headers: response.headers };
  }

  get(pathname: string) {
    return this.request("GET", pathname);
  }
  post(pathname: string, body?: unknown, extraHeaders?: Record<string, string>) {
    return this.request("POST", pathname, body, extraHeaders);
  }
  delete(pathname: string) {
    return this.request("DELETE", pathname);
  }
}

export async function createAdminAndLogin(
  client: TestClient,
  overrides: Partial<{ displayName: string; email: string; password: string }> = {},
): Promise<void> {
  const response = await client.post("/api/v1/setup", {
    displayName: overrides.displayName ?? "Test Admin",
    email: overrides.email ?? "admin@steward.test",
    password: overrides.password ?? "correct-horse-battery",
  });
  if (response.status !== 201) {
    throw new Error(`admin setup failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
}

export interface TestNode {
  runtime: NodeRuntime;
  nodeId: string;
  nodeName: string;
  workspaceDir: string;
  stop: () => Promise<void>;
}

/**
 * Enrolls and starts a real steward-node daemon against the test control
 * plane, backed by a throwaway git fixture workspace on local disk.
 */
export async function startTestNode(
  cp: ControlPlane,
  enrollmentToken: string,
  options: Partial<{ nodeName: string; readOnly: boolean }> = {},
): Promise<TestNode> {
  const nodeName = options.nodeName ?? `itest-node-${Date.now().toString(36)}`;
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "steward-itest-ws-"));
  const git = (args: string[]) => execFileSync("git", args, { cwd: workspaceDir });
  git(["init", "--initial-branch=main"]);
  git(["config", "user.email", "itest@steward.test"]);
  git(["config", "user.name", "Steward Integration Test"]);
  writeFileSync(path.join(workspaceDir, "README.md"), "# integration fixture\n");
  git(["add", "."]);
  git(["commit", "-m", "fixture"]);

  const enrolled = await enrollNode({
    serverUrl: cp.baseUrl,
    token: enrollmentToken,
    nodeName,
    allowInsecureHttp: true,
  });

  const config: NodeConfig = {
    serverUrl: cp.baseUrl,
    nodeName,
    workspaces: [
      {
        key: "fixture",
        name: "Fixture Workspace",
        path: workspaceDir,
        readOnly: options.readOnly ?? false,
      },
    ],
    agents: [
      { key: "diagnostic", type: "diagnostic", name: "Built-in Diagnostic Agent", enabled: true },
    ],
    maxConcurrentRuns: 2,
    logLevel: "fatal",
    allowInsecureHttp: true,
    redactValues: [],
  };
  const runtime = new NodeRuntime({
    config,
    credentials: {
      nodeId: enrolled.nodeId,
      nodeName: enrolled.nodeName,
      serverUrl: cp.baseUrl,
      credential: enrolled.credential,
      enrolledAt: new Date().toISOString(),
    },
    logger: testLog,
  });
  await runtime.start();

  return {
    runtime,
    nodeId: enrolled.nodeId,
    nodeName: enrolled.nodeName,
    workspaceDir,
    stop: async () => {
      await runtime.stop();
      rmSync(workspaceDir, { recursive: true, force: true });
    },
  };
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined | false | null>,
  options: Partial<{ timeoutMs: number; intervalMs: number; label: string }> = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== undefined && result !== false && result !== null) return result;
    if (Date.now() > deadline) {
      throw new Error(
        `waitFor timed out after ${timeoutMs}ms${options.label ? `: ${options.label}` : ""}`,
      );
    }
    await sleep(intervalMs);
  }
}

export interface SseEvent {
  id?: string;
  event: string;
  data: Json;
}

/**
 * Consumes the run SSE stream until `stream.end` (or an optional early-stop
 * predicate matches), returning every event received.
 */
export async function collectSseEvents(
  cp: ControlPlane,
  client: TestClient,
  runId: string,
  options: Partial<{
    lastEventId: number;
    timeoutMs: number;
    stopWhen: (events: SseEvent[]) => boolean;
  }> = {},
): Promise<SseEvent[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  const headers: Record<string, string> = { accept: "text/event-stream" };
  const session = client.cookie("stx_session");
  const csrf = client.cookie("stx_csrf");
  headers["cookie"] = [session ? `stx_session=${session}` : null, csrf ? `stx_csrf=${csrf}` : null]
    .filter(Boolean)
    .join("; ");
  if (options.lastEventId !== undefined) {
    headers["last-event-id"] = String(options.lastEventId);
  }

  const events: SseEvent[] = [];
  try {
    const response = await fetch(`${cp.baseUrl}/api/v1/runs/${runId}/events/stream`, {
      headers,
      signal: controller.signal,
    });
    if (response.status !== 200 || !response.body) {
      throw new Error(`SSE stream failed: HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseBlock(rawEvent);
        if (parsed) events.push(parsed);
      }
      if (events.some((e) => e.event === "stream.end")) return events;
      if (options.stopWhen?.(events)) {
        controller.abort();
        return events;
      }
    }
    return events;
  } catch (err) {
    if (controller.signal.aborted && (options.stopWhen?.(events) ?? false)) return events;
    if (controller.signal.aborted) {
      throw new Error(
        `SSE stream aborted after timeout with ${events.length} events: ` +
          JSON.stringify(events.map((e) => e.event)),
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function parseSseBlock(block: string): SseEvent | null {
  let id: string | undefined;
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue; // comment / ping
    if (line.startsWith("id:")) id = line.slice(3).trim();
    else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    else if (line.startsWith("retry:")) return null;
  }
  if (dataLines.length === 0) return null;
  let data: unknown = dataLines.join("\n");
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    // keep raw string
  }
  return { id, event, data };
}
