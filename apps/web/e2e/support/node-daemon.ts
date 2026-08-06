/**
 * Drives the real steward-node CLI (enroll + start) against the E2E control
 * plane, exactly the way an operator would, with a throwaway git fixture
 * workspace and state directory.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_URL, REPO_ROOT } from "./stack";

const NODE_APP_DIR = path.join(REPO_ROOT, "apps/node");

export interface NodeDaemonHandle {
  nodeName: string;
  workspaceDir: string;
  stop: () => Promise<void>;
}

export async function startNodeDaemon(options: {
  token: string;
  nodeName: string;
}): Promise<NodeDaemonHandle> {
  const root = mkdtempSync(path.join(os.tmpdir(), "steward-e2e-node-"));
  const workspaceDir = path.join(root, "fixture-workspace");
  const stateDir = path.join(root, "state");
  mkdirSync(workspaceDir, { recursive: true });

  const git = (args: string[]) => execFileSync("git", args, { cwd: workspaceDir });
  git(["init", "--initial-branch=main"]);
  git(["config", "user.email", "e2e@steward.test"]);
  git(["config", "user.name", "Steward E2E"]);
  writeFileSync(path.join(workspaceDir, "README.md"), "# E2E fixture workspace\n");
  git(["add", "."]);
  git(["commit", "-m", "fixture"]);

  const configPath = path.join(root, "steward-node.yaml");
  writeFileSync(
    configPath,
    [
      `serverUrl: "${API_URL}"`,
      `nodeName: "${options.nodeName}"`,
      "allowInsecureHttp: true",
      'logLevel: "warn"',
      "maxConcurrentRuns: 2",
      "workspaces:",
      '  - key: "fixture"',
      '    name: "E2E Fixture Workspace"',
      `    path: "${workspaceDir}"`,
      "    readOnly: false",
      "agents:",
      '  - key: "diagnostic"',
      '    type: "diagnostic"',
      '    name: "Built-in Diagnostic Agent"',
      "    enabled: true",
      "",
    ].join("\n"),
  );

  execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "src/cli.ts",
      "--state-dir",
      stateDir,
      "enroll",
      "--server",
      API_URL,
      "--token",
      options.token,
      "--name",
      options.nodeName,
      "--insecure-http",
    ],
    { cwd: NODE_APP_DIR, stdio: "pipe" },
  );

  const daemon: ChildProcess = spawn(
    "pnpm",
    ["exec", "tsx", "src/cli.ts", "--config", configPath, "--state-dir", stateDir, "start"],
    { cwd: NODE_APP_DIR, stdio: ["ignore", "pipe", "pipe"] },
  );

  return {
    nodeName: options.nodeName,
    workspaceDir,
    stop: () =>
      new Promise<void>((resolve) => {
        const cleanup = () => {
          rmSync(root, { recursive: true, force: true });
          resolve();
        };
        if (daemon.exitCode !== null) return cleanup();
        daemon.once("exit", cleanup);
        daemon.kill("SIGTERM");
        setTimeout(() => {
          if (daemon.exitCode === null) daemon.kill("SIGKILL");
        }, 5000).unref();
      }),
  };
}
