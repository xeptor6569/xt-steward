import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export interface DatabaseHandle {
  db: ReturnType<typeof createDrizzle>;
  close: () => Promise<void>;
}

function createDrizzle(client: postgres.Sql) {
  return drizzle(client, { schema, casing: "snake_case" });
}

export type Database = ReturnType<typeof createDrizzle>;

export function createDatabase(
  databaseUrl: string,
  options: { max?: number } = {},
): DatabaseHandle {
  const client = postgres(databaseUrl, {
    max: options.max ?? 10,
    onnotice: () => {
      /* suppress NOTICE chatter; real errors still throw */
    },
  });
  return {
    db: createDrizzle(client),
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}

/** Postgres unique-violation SQLSTATE, used for idempotent inserts. */
export const PG_UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}
