import { fileURLToPath } from "node:url";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

/** Applies all checked-in SQL migrations. Safe to run repeatedly. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const databaseUrl = process.env.STEWARD_DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write("STEWARD_DATABASE_URL is required\n");
    process.exit(1);
  }
  runMigrations(databaseUrl)
    .then(() => {
      process.stdout.write("migrations applied\n");
      process.exit(0);
    })
    .catch((err: unknown) => {
      process.stderr.write(
        `migration failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
}
