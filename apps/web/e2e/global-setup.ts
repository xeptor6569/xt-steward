/**
 * Boots the backend half of the E2E stack: provisions PostgreSQL + Redis,
 * then starts the real API and worker processes. The Next.js dev server is
 * managed separately by Playwright's webServer option. Requires PostgreSQL
 * and Redis to be reachable (see STEWARD_E2E_DATABASE_URL /
 * STEWARD_E2E_REDIS_URL in e2e/support/stack.ts).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import {
  API_PORT,
  API_URL,
  E2E_DATABASE_URL,
  E2E_REDIS_URL,
  REPO_ROOT,
  WEB_URL,
} from "./support/stack";

const children: ChildProcess[] = [];

const backendEnv = {
  ...process.env,
  // Next's types narrow NODE_ENV to a literal union.
  NODE_ENV: "test" as const,
  STEWARD_DATABASE_URL: E2E_DATABASE_URL,
  STEWARD_REDIS_URL: E2E_REDIS_URL,
  STEWARD_LOG_LEVEL: "warn",
  STEWARD_API_HOST: "127.0.0.1",
  STEWARD_API_PORT: String(API_PORT),
  STEWARD_WEB_ORIGIN: WEB_URL,
  STEWARD_HEARTBEAT_INTERVAL_MS: "1000",
  STEWARD_NODE_OFFLINE_AFTER_MS: "5000",
  STEWARD_CANCEL_GRACE_MS: "2000",
  STEWARD_MAINTENANCE_INTERVAL_MS: "2000",
};

function startProcess(name: string, cwd: string, args: string[]): ChildProcess {
  const logDir = path.resolve(__dirname, "../test-results");
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(path.join(logDir, `${name}.log`));
  const child = spawn("pnpm", ["exec", ...args], { cwd, env: backendEnv });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  child.on("exit", (code) => log.write(`\n[${name} exited with code ${code}]\n`));
  children.push(child);
  return child;
}

async function waitForApiReady(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${API_URL}/api/v1/health/ready`);
      if (response.status === 200) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(`API did not become ready at ${API_URL} within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export default async function globalSetup(): Promise<void> {
  const provision = spawnSync("pnpm", ["exec", "tsx", "e2e/support/provision.ts"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      STEWARD_E2E_DATABASE_URL: E2E_DATABASE_URL,
      STEWARD_E2E_REDIS_URL: E2E_REDIS_URL,
    },
    encoding: "utf8",
  });
  if (provision.status !== 0) {
    throw new Error(
      `E2E provisioning failed.\nstdout: ${provision.stdout}\nstderr: ${provision.stderr}\n` +
        "PostgreSQL and Redis must be reachable; see e2e/support/stack.ts.",
    );
  }

  startProcess("e2e-api", path.join(REPO_ROOT, "apps/api"), ["tsx", "src/server.ts"]);
  startProcess("e2e-worker", path.join(REPO_ROOT, "apps/worker"), ["tsx", "src/server.ts"]);
  await waitForApiReady();

  (globalThis as Record<string, unknown>).__stewardE2eChildren = children;
}
