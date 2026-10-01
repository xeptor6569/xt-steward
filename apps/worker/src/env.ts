import { booleanString, intString, LOG_LEVELS, parseEnv } from "@steward/shared";
import { z } from "zod";

const shape = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  STEWARD_DATABASE_URL: z.string().min(1),
  STEWARD_REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  STEWARD_LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  STEWARD_LOG_PRETTY: booleanString.default(false),
  STEWARD_NODE_OFFLINE_AFTER_MS: intString.default(45_000),
  STEWARD_RUN_TIMEOUT_MS: intString.default(900_000),
  STEWARD_RUN_LOST_TIMEOUT_MS: intString.default(60_000),
  STEWARD_CANCEL_GRACE_MS: intString.default(5_000),
  STEWARD_MAINTENANCE_INTERVAL_MS: intString.default(10_000),
};

export type WorkerEnv = ReturnType<typeof loadWorkerEnv>;

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env) {
  const raw = parseEnv(shape, source);
  return {
    nodeEnv: raw.NODE_ENV,
    databaseUrl: raw.STEWARD_DATABASE_URL,
    redisUrl: raw.STEWARD_REDIS_URL,
    logLevel: raw.STEWARD_LOG_LEVEL,
    logPretty: raw.STEWARD_LOG_PRETTY,
    nodeOfflineAfterMs: raw.STEWARD_NODE_OFFLINE_AFTER_MS,
    runTimeoutMs: raw.STEWARD_RUN_TIMEOUT_MS,
    runLostTimeoutMs: raw.STEWARD_RUN_LOST_TIMEOUT_MS,
    cancelGraceMs: raw.STEWARD_CANCEL_GRACE_MS,
    maintenanceIntervalMs: raw.STEWARD_MAINTENANCE_INTERVAL_MS,
  };
}
