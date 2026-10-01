/**
 * Standalone migration entrypoint bundled into the API image. Run as a
 * one-shot container (`node dist/migrate.js`) before the API and worker
 * start. Reads STEWARD_DATABASE_URL and STEWARD_MIGRATIONS_DIR.
 */
import { runMigrations } from "@steward/database/migrate";

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
    process.stderr.write(`migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
