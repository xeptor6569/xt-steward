import { sessions, users } from "@steward/database";
import type { Database } from "@steward/database";
import { generateSecretToken, hashSecretToken, newId } from "@steward/shared";
import { and, eq, gt } from "drizzle-orm";

export type UserRow = typeof users.$inferSelect;

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  db: Database,
  userId: string,
  ttlHours: number,
): Promise<CreatedSession> {
  const token = generateSecretToken("session");
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
  await db.insert(sessions).values({
    id: newId("sess"),
    userId,
    tokenHash: hashSecretToken(token),
    expiresAt,
  });
  return { token, expiresAt };
}

/** Resolves a session cookie value to its user, or null when invalid/expired. */
export async function getSessionUser(db: Database, token: string): Promise<UserRow | null> {
  if (!token.startsWith("stx_sess_")) return null;
  const tokenHash = hashSecretToken(token);
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function destroySession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSecretToken(token)));
}
