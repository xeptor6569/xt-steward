import { auditEvents } from "@steward/database";
import type { Database } from "@steward/database";
import { newId } from "@steward/shared";

export interface AuditInput {
  actorType: "user" | "node" | "system";
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(db: Database, input: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId("audit"),
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? {},
  });
}
