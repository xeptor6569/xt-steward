"use client";

/** Browser-side API client: same-site cookies + double-submit CSRF header. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STEWARD_API_URL ?? "http://localhost:3001";
}

function readCsrfCookie(): string | null {
  const match = /(?:^|;\s*)(?:__Host-)?stx_csrf=([^;]+)/.exec(document.cookie);
  return match?.[1] ?? null;
}

/**
 * The API issues the CSRF cookie on any response. On a fresh browser (e.g.
 * the first-boot setup form) no API request has happened yet, so fetch one
 * before the first state-changing call.
 */
async function ensureCsrfCookie(): Promise<string | null> {
  const existing = readCsrfCookie();
  if (existing) return existing;
  try {
    await fetch(`${apiBaseUrl()}/api/v1/setup/status`, { credentials: "include" });
  } catch {
    return null;
  }
  return readCsrfCookie();
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    const csrf = await ensureCsrfCookie();
    if (csrf) headers["x-steward-csrf"] = csrf;
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers,
    credentials: "include",
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "request_failed",
      error?.message ?? `Request failed with status ${response.status}`,
    );
  }
  return payload as T;
}
