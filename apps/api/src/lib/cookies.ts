import type { CookieSerializeOptions } from "@fastify/cookie";
import type { ApiEnv } from "../env.js";

/**
 * Cookies are host-only (no Domain attribute) so they are never shared with
 * sibling hosts under the same registrable domain (e.g. a marketing site).
 * When Secure is enabled the __Host- prefix makes the browser enforce
 * Secure + Path=/ + no Domain.
 */
export function sessionCookieName(env: ApiEnv): string {
  return env.cookieSecure ? "__Host-stx_session" : "stx_session";
}

export function csrfCookieName(env: ApiEnv): string {
  return env.cookieSecure ? "__Host-stx_csrf" : "stx_csrf";
}

export const CSRF_HEADER = "x-steward-csrf";

export function sessionCookieOptions(env: ApiEnv, expiresAt: Date): CookieSerializeOptions {
  return {
    path: "/",
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax",
    expires: expiresAt,
  };
}

export function csrfCookieOptions(env: ApiEnv): CookieSerializeOptions {
  return {
    path: "/",
    // Deliberately readable by dashboard JavaScript (double-submit pattern).
    httpOnly: false,
    secure: env.cookieSecure,
    sameSite: "lax",
  };
}

export function clearedCookieOptions(env: ApiEnv): CookieSerializeOptions {
  return {
    path: "/",
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax",
    expires: new Date(0),
  };
}
