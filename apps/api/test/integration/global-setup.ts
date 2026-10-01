/**
 * Integration test infrastructure. Provisions PostgreSQL and Redis for the
 * suite, in order of preference:
 *
 *   1. Explicit URLs via STEWARD_TEST_DATABASE_URL / STEWARD_TEST_REDIS_URL.
 *   2. Throwaway containers via Testcontainers (requires Docker).
 *   3. Locally running services (postgres://steward:steward@localhost:5432,
 *      redis://localhost:6379/7) as a fallback for Docker-less environments.
 *
 * Migrations are applied once here; individual tests reset table contents.
 */
import { runMigrations } from "@steward/database/migrate";
import { Redis } from "ioredis";
import postgres from "postgres";
import type { TestProject } from "vitest/node";

const FALLBACK_DATABASE_URL = "postgres://steward:steward@localhost:5432/steward_xt_test";
const FALLBACK_REDIS_URL = "redis://localhost:6379/7";

interface Provisioned {
  databaseUrl: string;
  redisUrl: string;
  teardown: () => Promise<void>;
}

async function tryTestcontainers(): Promise<Provisioned | null> {
  try {
    const [{ PostgreSqlContainer }, { RedisContainer }] = await Promise.all([
      import("@testcontainers/postgresql"),
      import("@testcontainers/redis"),
    ]);
    const [pg, redis] = await Promise.all([
      new PostgreSqlContainer("postgres:17-alpine").start(),
      new RedisContainer("redis:7-alpine").start(),
    ]);
    return {
      databaseUrl: pg.getConnectionUri(),
      redisUrl: redis.getConnectionUrl(),
      teardown: async () => {
        await Promise.allSettled([pg.stop(), redis.stop()]);
      },
    };
  } catch {
    return null;
  }
}

async function assertPostgresReachable(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
  try {
    await client`select 1`;
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function assertRedisReachable(redisUrl: string): Promise<void> {
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.ping();
  } finally {
    redis.disconnect();
  }
}

async function provision(): Promise<Provisioned> {
  const explicitDb = process.env.STEWARD_TEST_DATABASE_URL;
  const explicitRedis = process.env.STEWARD_TEST_REDIS_URL;
  if (explicitDb && explicitRedis) {
    return { databaseUrl: explicitDb, redisUrl: explicitRedis, teardown: async () => {} };
  }

  const containers = await tryTestcontainers();
  if (containers) return containers;

  const databaseUrl = explicitDb ?? FALLBACK_DATABASE_URL;
  const redisUrl = explicitRedis ?? FALLBACK_REDIS_URL;
  try {
    await Promise.all([assertPostgresReachable(databaseUrl), assertRedisReachable(redisUrl)]);
  } catch (err) {
    throw new Error(
      "Integration tests need PostgreSQL and Redis. Either install Docker " +
        "(Testcontainers will provision them) or point " +
        "STEWARD_TEST_DATABASE_URL / STEWARD_TEST_REDIS_URL at running services. " +
        `Probe failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { databaseUrl, redisUrl, teardown: async () => {} };
}

export default async function globalSetup(project: TestProject): Promise<() => Promise<void>> {
  const provisioned = await provision();
  await runMigrations(provisioned.databaseUrl);
  project.provide("databaseUrl", provisioned.databaseUrl);
  project.provide("redisUrl", provisioned.redisUrl);
  return provisioned.teardown;
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}
