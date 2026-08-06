import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const credentialsSchema = z.object({
  nodeId: z.string().min(1),
  nodeName: z.string().min(1),
  serverUrl: z.url(),
  /** Plaintext bearer credential; the server stores only its hash. */
  credential: z.string().startsWith("stx_node_"),
  enrolledAt: z.string(),
});

export type NodeCredentials = z.infer<typeof credentialsSchema>;

export function defaultStateDir(): string {
  return (
    process.env.STEWARD_NODE_STATE_DIR ?? path.join(os.homedir(), ".local", "state", "steward-node")
  );
}

export function credentialsPath(stateDir: string): string {
  return path.join(stateDir, "credentials.json");
}

/** Written with 0600 (file) / 0700 (dir): the credential never leaves this host. */
export function saveCredentials(stateDir: string, credentials: NodeCredentials): string {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
  const file = credentialsPath(stateDir);
  writeFileSync(file, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

export function loadCredentials(stateDir: string): NodeCredentials | null {
  const file = credentialsPath(stateDir);
  if (!existsSync(file)) return null;
  const parsed = credentialsSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new Error(`credentials file is corrupt: ${file} (re-enroll with steward-node enroll)`);
  }
  return parsed.data;
}
