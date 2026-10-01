import os from "node:os";
import { z } from "zod";
import { STEWARD_NODE_VERSION } from "./version.js";

const enrollResponseSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  credential: z.string().startsWith("stx_node_"),
  serverTime: z.string(),
});

export interface EnrollOptions {
  serverUrl: string;
  token: string;
  nodeName: string;
  allowInsecureHttp: boolean;
  labels?: Record<string, string>;
}

export interface EnrollResult {
  nodeId: string;
  nodeName: string;
  credential: string;
}

/**
 * Exchanges a one-time enrollment token for a permanent node credential. The
 * token is transmitted once over TLS (or plain HTTP only when the development
 * escape hatch is explicitly enabled) and never logged.
 */
export async function enrollNode(options: EnrollOptions): Promise<EnrollResult> {
  const url = new URL(options.serverUrl);
  if (url.protocol === "http:" && !options.allowInsecureHttp) {
    throw new Error(
      "refusing to enroll over plain http:// — use https:// or pass --insecure-http for local development",
    );
  }

  const response = await fetch(new URL("/api/v1/nodes/enroll", options.serverUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: options.token,
      name: options.nodeName,
      version: STEWARD_NODE_VERSION,
      os: { platform: os.platform(), release: os.release(), arch: os.arch() },
      labels: options.labels ?? {},
    }),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string; code?: string } };
      if (body.error?.message) detail = `${body.error.code ?? "error"}: ${body.error.message}`;
    } catch {
      // Non-JSON error body; keep the HTTP status as the detail.
    }
    throw new Error(`enrollment failed — ${detail}`);
  }

  const parsed = enrollResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("enrollment failed — server returned an unexpected response shape");
  }
  return {
    nodeId: parsed.data.nodeId,
    nodeName: parsed.data.nodeName,
    credential: parsed.data.credential,
  };
}
