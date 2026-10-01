import { describe, expect, it } from "vitest";
import type { ApiEnv } from "../../src/env.js";
import { loadApiEnv } from "../../src/env.js";
import {
  csrfCookieName,
  csrfCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
} from "../../src/lib/cookies.js";

function makeEnv(overrides: Record<string, string> = {}): ApiEnv {
  return loadApiEnv({
    STEWARD_DATABASE_URL: "postgres://example/db",
    ...overrides,
  });
}

describe("cookie configuration", () => {
  it("uses the __Host- prefix whenever Secure is enabled", () => {
    const env = makeEnv({ STEWARD_COOKIE_SECURE: "true" });
    expect(sessionCookieName(env)).toBe("__Host-stx_session");
    expect(csrfCookieName(env)).toBe("__Host-stx_csrf");
  });

  it("falls back to unprefixed names for plain-HTTP development", () => {
    const env = makeEnv({ STEWARD_COOKIE_SECURE: "false" });
    expect(sessionCookieName(env)).toBe("stx_session");
    expect(csrfCookieName(env)).toBe("stx_csrf");
  });

  it("defaults Secure on in production", () => {
    const env = makeEnv({ NODE_ENV: "production" });
    expect(env.cookieSecure).toBe(true);
    expect(sessionCookieName(env)).toBe("__Host-stx_session");
  });

  it("session cookies are HttpOnly, SameSite=Lax, host-only (no Domain), path=/", () => {
    const env = makeEnv({ STEWARD_COOKIE_SECURE: "true" });
    const options = sessionCookieOptions(env, new Date(Date.now() + 1000));
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.secure).toBe(true);
    expect(options.path).toBe("/");
    expect("domain" in options).toBe(false);
  });

  it("csrf cookie is readable by the dashboard (double-submit pattern)", () => {
    const env = makeEnv({ STEWARD_COOKIE_SECURE: "true" });
    const options = csrfCookieOptions(env);
    expect(options.httpOnly).toBe(false);
    expect(options.secure).toBe(true);
  });
});

describe("environment parsing", () => {
  it("fails fast with a readable message when required variables are missing", () => {
    expect(() => loadApiEnv({})).toThrow(/STEWARD_DATABASE_URL/);
  });

  it("applies documented defaults", () => {
    const env = makeEnv();
    expect(env.port).toBe(3001);
    expect(env.webOrigin).toBe("http://localhost:3000");
    expect(env.heartbeatIntervalMs).toBe(15_000);
    expect(env.runLostTimeoutMs).toBe(60_000);
  });
});
