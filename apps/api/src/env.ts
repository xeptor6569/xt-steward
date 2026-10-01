import { booleanString, intString, LOG_LEVELS, parseEnv } from "@steward/shared";
import { z } from "zod";

const shape = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  STEWARD_DATABASE_URL: z.string().min(1),
  STEWARD_REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  STEWARD_API_HOST: z.string().default("0.0.0.0"),
  STEWARD_API_PORT: intString.default(3001),
  /** Exact browser origin allowed for credentialed CORS (the dashboard). */
  STEWARD_WEB_ORIGIN: z.url().default("http://localhost:3000"),
  /** Defaults to true in production. Controls Secure cookies + __Host- prefix. */
  STEWARD_COOKIE_SECURE: booleanString.optional(),
  STEWARD_TRUST_PROXY: booleanString.default(false),
  STEWARD_LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  STEWARD_LOG_PRETTY: booleanString.default(false),
  STEWARD_SESSION_TTL_HOURS: intString.default(168),
  STEWARD_ENROLLMENT_TOKEN_TTL_MINUTES: intString.default(60),
  STEWARD_HEARTBEAT_INTERVAL_MS: intString.default(15_000),
  STEWARD_NODE_OFFLINE_AFTER_MS: intString.default(45_000),
  STEWARD_RUN_TIMEOUT_MS: intString.default(900_000),
  STEWARD_RUN_LOST_TIMEOUT_MS: intString.default(60_000),
  STEWARD_CANCEL_GRACE_MS: intString.default(5_000),
  STEWARD_RATE_LIMIT_MAX: intString.default(300),
  STEWARD_AUTH_RATE_LIMIT_MAX: intString.default(10),
  /**
   * Placeholders for the next milestone (GitHub OAuth / GitHub App). Parsed
   * so deployments can stage configuration, but intentionally unused: no
   * GitHub integration is faked in this milestone. See docs/roadmap.md.
   */
  STEWARD_GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  STEWARD_GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  STEWARD_GITHUB_APP_ID: z.string().optional(),
};

export type ApiEnv = ReturnType<typeof loadApiEnv>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env) {
  const raw = parseEnv(shape, source);
  return {
    nodeEnv: raw.NODE_ENV,
    isProduction: raw.NODE_ENV === "production",
    databaseUrl: raw.STEWARD_DATABASE_URL,
    redisUrl: raw.STEWARD_REDIS_URL,
    host: raw.STEWARD_API_HOST,
    port: raw.STEWARD_API_PORT,
    webOrigin: raw.STEWARD_WEB_ORIGIN,
    cookieSecure: raw.STEWARD_COOKIE_SECURE ?? raw.NODE_ENV === "production",
    trustProxy: raw.STEWARD_TRUST_PROXY,
    logLevel: raw.STEWARD_LOG_LEVEL,
    logPretty: raw.STEWARD_LOG_PRETTY,
    sessionTtlHours: raw.STEWARD_SESSION_TTL_HOURS,
    enrollmentTokenTtlMinutes: raw.STEWARD_ENROLLMENT_TOKEN_TTL_MINUTES,
    heartbeatIntervalMs: raw.STEWARD_HEARTBEAT_INTERVAL_MS,
    nodeOfflineAfterMs: raw.STEWARD_NODE_OFFLINE_AFTER_MS,
    runTimeoutMs: raw.STEWARD_RUN_TIMEOUT_MS,
    runLostTimeoutMs: raw.STEWARD_RUN_LOST_TIMEOUT_MS,
    cancelGraceMs: raw.STEWARD_CANCEL_GRACE_MS,
    rateLimitMax: raw.STEWARD_RATE_LIMIT_MAX,
    authRateLimitMax: raw.STEWARD_AUTH_RATE_LIMIT_MAX,
  };
}
