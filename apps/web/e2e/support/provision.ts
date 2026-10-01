/**
 * One-shot provisioning script executed (via tsx) by the Playwright global
 * setup: makes sure the E2E database exists, applies migrations, and wipes
 * all database + Redis state so the suite starts from "first boot".
 */
import { runMigrations } from "@steward/database/migrate";
import { Redis } from "ioredis";
import postgres from "postgres";

const databaseUrl = process.env.STEWARD_E2E_DATABASE_URL!;
const redisUrl = process.env.STEWARD_E2E_REDIS_URL!;

async function ensureDatabaseExists(): Promise<void> {
  const probe = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
  try {
    await probe`select 1`;
    return;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "3D000") throw err; // anything but "database does not exist"
  } finally {
    await probe.end({ timeout: 5 });
  }

  const url = new URL(databaseUrl);
  const dbName = url.pathname.slice(1);
  const maintenanceUrl = new URL(databaseUrl);
  maintenanceUrl.pathname = `/${process.env.STEWARD_E2E_MAINTENANCE_DB ?? "steward"}`;
  const admin = postgres(maintenanceUrl.toString(), { max: 1 });
  try {
    await admin.unsafe(`create database "${dbName.replaceAll('"', '""')}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function reset(): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(`
      truncate table
        audit_events, run_events, runs, agent_definitions, workspaces,
        node_enrollment_tokens, nodes, sessions, users
      restart identity cascade
    `);
  } finally {
    await client.end({ timeout: 5 });
  }
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}

async function main(): Promise<void> {
  await ensureDatabaseExists();
  await runMigrations(databaseUrl);
  await reset();
  process.stdout.write("e2e database and redis provisioned\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
