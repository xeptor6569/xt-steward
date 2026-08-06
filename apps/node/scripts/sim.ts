/**
 * Development-only simulated node. Creates a fixture git workspace under
 * .dev/sim-node/, enrolls against a local control plane (one-time token via
 * --token or STEWARD_SIM_TOKEN), and starts the regular NodeRuntime — the
 * exact same code path a real node uses.
 *
 * Usage:
 *   pnpm node:sim -- --token stx_enroll_xxxxx
 *   STEWARD_SIM_TOKEN=stx_enroll_xxxxx pnpm node:sim
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createLogger } from "@steward/shared";
import type { NodeConfig } from "../src/config.js";
import { loadCredentials, saveCredentials } from "../src/credentials.js";
import { enrollNode } from "../src/enroll.js";
import { NodeRuntime } from "../src/runtime.js";

/* eslint-disable no-console -- development helper script */

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const simRoot = path.join(repoRoot, ".dev", "sim-node");
const workspaceDir = path.join(simRoot, "fixture-workspace");
const stateDir = path.join(simRoot, "state");

const serverUrl = process.env.STEWARD_SIM_SERVER ?? "http://localhost:3001";
const nodeName = process.env.STEWARD_SIM_NODE_NAME ?? "sim-node-01";
const tokenFlagIndex = process.argv.indexOf("--token");
const token =
  (tokenFlagIndex >= 0 ? process.argv[tokenFlagIndex + 1] : undefined) ??
  process.env.STEWARD_SIM_TOKEN;

function ensureFixtureWorkspace(): void {
  if (existsSync(path.join(workspaceDir, ".git"))) return;
  mkdirSync(workspaceDir, { recursive: true });
  const git = (args: string[]) => execFileSync("git", args, { cwd: workspaceDir });
  git(["init", "--initial-branch=main"]);
  git(["config", "user.email", "sim@steward.local"]);
  git(["config", "user.name", "Steward Sim"]);
  writeFileSync(
    path.join(workspaceDir, "README.md"),
    "# Simulated workspace\n\nFixture project used by the Steward XT simulated development node.\n",
  );
  writeFileSync(path.join(workspaceDir, "hello.txt"), "hello from the simulated node\n");
  git(["add", "."]);
  git(["commit", "-m", "fixture workspace"]);
  console.log(`created fixture workspace at ${workspaceDir}`);
}

async function main(): Promise<void> {
  ensureFixtureWorkspace();

  let credentials = loadCredentials(stateDir);
  if (!credentials) {
    if (!token) {
      console.error(
        "sim node is not enrolled yet.\n" +
          "Create an enrollment token in the dashboard (Nodes -> Create enrollment token)\n" +
          "then run: pnpm node:sim -- --token stx_enroll_xxxxx",
      );
      process.exit(1);
    }
    const result = await enrollNode({
      serverUrl,
      token,
      nodeName,
      allowInsecureHttp: true,
    });
    credentials = {
      nodeId: result.nodeId,
      nodeName: result.nodeName,
      serverUrl,
      credential: result.credential,
      enrolledAt: new Date().toISOString(),
    };
    saveCredentials(stateDir, credentials);
    console.log(`enrolled sim node as ${result.nodeName} (${result.nodeId})`);
  }

  const config: NodeConfig = {
    serverUrl,
    nodeName: credentials.nodeName,
    workspaces: [
      { key: "fixture", name: "Fixture Workspace", path: workspaceDir, readOnly: false },
    ],
    agents: [
      { key: "diagnostic", type: "diagnostic", name: "Built-in Diagnostic Agent", enabled: true },
    ],
    maxConcurrentRuns: 2,
    logLevel: "info",
    allowInsecureHttp: true,
    redactValues: [],
  };

  const logger = createLogger({ service: "steward-node-sim", level: "info", pretty: true });
  const runtime = new NodeRuntime({ config, credentials, logger });

  process.on("SIGINT", () => void runtime.stop().then(() => process.exit(0)));
  process.on("SIGTERM", () => void runtime.stop().then(() => process.exit(0)));

  await runtime.start();
  console.log("simulated node running — press Ctrl-C to stop");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
