import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnCollect } from "@steward/agents";
import { externalKeySchema } from "@steward/protocol";
import { LOG_LEVELS } from "@steward/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { validateWorkspacePath, WorkspacePathError } from "./workspace-security.js";

export const nodeConfigSchema = z.object({
  serverUrl: z.url(),
  nodeName: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, "node name must be alphanumeric with . _ -"),
  workspaces: z
    .array(
      z.object({
        key: externalKeySchema,
        name: z.string().min(1).max(120),
        path: z.string().min(1),
        readOnly: z.boolean().default(false),
      }),
    )
    .min(0)
    .max(128),
  agents: z
    .array(
      z.object({
        key: externalKeySchema,
        type: z.enum(["diagnostic"]),
        name: z.string().min(1).max(120),
        enabled: z.boolean().default(true),
      }),
    )
    .default([]),
  maxConcurrentRuns: z.number().int().min(1).max(64).default(2),
  logLevel: z.enum(LOG_LEVELS).default("info"),
  /**
   * Development-only escape hatch: allows ws:// (plain HTTP) transport. In
   * production the node refuses anything but wss:// (TLS).
   */
  allowInsecureHttp: z.boolean().default(false),
  /** Extra secret strings to redact from all run output. */
  redactValues: z.array(z.string()).default([]),
});

export type NodeConfig = z.infer<typeof nodeConfigSchema>;

export interface ValidatedWorkspace {
  key: string;
  name: string;
  configuredPath: string;
  canonicalPath: string;
  readOnly: boolean;
  repositoryUrl: string | null;
  defaultBranch: string | null;
}

export interface ValidatedConfig {
  config: NodeConfig;
  workspaces: ValidatedWorkspace[];
  /** Human-readable problems for workspaces that failed validation. */
  workspaceErrors: { key: string; error: string }[];
}

export function defaultConfigPaths(): string[] {
  return [
    path.join(process.cwd(), "steward-node.yaml"),
    path.join(os.homedir(), ".config", "steward-node", "config.yaml"),
    "/etc/steward-node/config.yaml",
  ];
}

export function loadConfigFile(configPath: string): NodeConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(`cannot read config file: ${configPath}`);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error(
      `config file is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = nodeConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`invalid node configuration (${configPath}):\n${issues}`);
  }

  const keys = new Set<string>();
  for (const ws of result.data.workspaces) {
    if (keys.has(ws.key)) throw new Error(`duplicate workspace key: ${ws.key}`);
    keys.add(ws.key);
  }
  const agentKeys = new Set<string>();
  for (const agent of result.data.agents) {
    if (agentKeys.has(agent.key)) throw new Error(`duplicate agent key: ${agent.key}`);
    agentKeys.add(agent.key);
  }

  const url = new URL(result.data.serverUrl);
  if (url.protocol === "http:" && !result.data.allowInsecureHttp) {
    throw new Error(
      "serverUrl uses plain http:// — TLS (https://) is required unless allowInsecureHttp: true is set for local development",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`serverUrl must be http(s), got ${url.protocol}`);
  }

  return result.data;
}

/**
 * Validates every configured workspace (canonical path, existence, directory)
 * and collects best-effort git metadata for advertisement.
 */
export async function validateConfig(config: NodeConfig): Promise<ValidatedConfig> {
  const workspaces: ValidatedWorkspace[] = [];
  const workspaceErrors: { key: string; error: string }[] = [];

  for (const ws of config.workspaces) {
    try {
      const { canonicalPath } = validateWorkspacePath(ws.path);
      const git = await collectGitMetadata(canonicalPath);
      workspaces.push({
        key: ws.key,
        name: ws.name,
        configuredPath: ws.path,
        canonicalPath,
        readOnly: ws.readOnly,
        repositoryUrl: git.repositoryUrl,
        defaultBranch: git.defaultBranch,
      });
    } catch (err) {
      const message =
        err instanceof WorkspacePathError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      workspaceErrors.push({ key: ws.key, error: message });
    }
  }

  return { config, workspaces, workspaceErrors };
}

async function collectGitMetadata(
  canonicalPath: string,
): Promise<{ repositoryUrl: string | null; defaultBranch: string | null }> {
  const run = async (args: string[]) => {
    try {
      const result = await spawnCollect("git", args, { cwd: canonicalPath, timeoutMs: 5000 });
      return result.exitCode === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  };
  const inside = await run(["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return { repositoryUrl: null, defaultBranch: null };
  const repositoryUrl = await run(["remote", "get-url", "origin"]);
  const defaultBranch = await run(["rev-parse", "--abbrev-ref", "HEAD"]);
  return { repositoryUrl, defaultBranch };
}
