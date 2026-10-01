import { RUN_STATUSES } from "@steward/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// All timestamps are `timestamptz` and stored in UTC.
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const userRoleEnum = pgEnum("user_role", ["admin", "member"]);
export const nodeStatusEnum = pgEnum("node_status", ["online", "offline"]);
export const agentTypeEnum = pgEnum("agent_type", ["diagnostic"]);
export const runTypeEnum = pgEnum("run_type", ["diagnostic"]);
export const runStatusEnum = pgEnum("run_status", RUN_STATUSES);
export const runEventTypeEnum = pgEnum("run_event_type", ["log", "notice", "state"]);
export const runStreamEnum = pgEnum("run_stream", ["stdout", "stderr"]);
export const actorTypeEnum = pgEnum("actor_type", ["user", "node", "system"]);

export const users = pgTable("users", {
  id: text().primaryKey(),
  displayName: text().notNull(),
  email: text().unique(),
  role: userRoleEnum().notNull().default("member"),
  /** Nullable so future OAuth-only identities can exist without a password. */
  passwordHash: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the bearer token; the plaintext is only in the cookie. */
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const nodes = pgTable(
  "nodes",
  {
    id: text().primaryKey(),
    name: text().notNull().unique(),
    status: nodeStatusEnum().notNull().default("offline"),
    version: text(),
    labels: jsonb().$type<Record<string, string>>().notNull().default({}),
    capabilities: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),
    /** SHA-256 of the node bearer credential; plaintext lives only on the node. */
    credentialHash: text().notNull().unique(),
    lastConnectedAt: timestamp({ withTimezone: true }),
    lastHeartbeatAt: timestamp({ withTimezone: true }),
    maxConcurrentRuns: integer().notNull().default(2),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("nodes_status_idx").on(t.status)],
);

export const nodeEnrollmentTokens = pgTable(
  "node_enrollment_tokens",
  {
    id: text().primaryKey(),
    /** SHA-256 of the one-time token; the plaintext is shown exactly once. */
    tokenHash: text().notNull().unique(),
    name: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [index("node_enrollment_tokens_expires_at_idx").on(t.expiresAt)],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text().primaryKey(),
    nodeId: text()
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    /** Operator-chosen key from the node's local config; unique per node. */
    externalKey: text().notNull(),
    name: text().notNull(),
    /** Canonical path as advertised by the node. Display only on the server. */
    localPath: text().notNull(),
    repositoryUrl: text(),
    defaultBranch: text(),
    readOnly: boolean().notNull().default(false),
    enabled: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("workspaces_node_id_external_key_uq").on(t.nodeId, t.externalKey),
    index("workspaces_node_id_idx").on(t.nodeId),
  ],
);

export const agentDefinitions = pgTable(
  "agent_definitions",
  {
    id: text().primaryKey(),
    nodeId: text()
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    externalKey: text().notNull(),
    type: agentTypeEnum().notNull(),
    name: text().notNull(),
    version: text(),
    enabled: boolean().notNull().default(true),
    capabilities: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("agent_definitions_node_id_external_key_uq").on(t.nodeId, t.externalKey),
    index("agent_definitions_node_id_idx").on(t.nodeId),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    nodeId: text()
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    agentDefinitionId: text().references(() => agentDefinitions.id, { onDelete: "set null" }),
    type: runTypeEnum().notNull(),
    status: runStatusEnum().notNull().default("queued"),
    requestedByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    task: text(),
    queuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    exitCode: integer(),
    errorCode: text(),
    errorMessage: text(),
    cancellationRequestedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("runs_status_idx").on(t.status),
    index("runs_node_id_status_idx").on(t.nodeId, t.status),
    index("runs_workspace_id_idx").on(t.workspaceId),
    index("runs_created_at_idx").on(t.createdAt),
  ],
);

export const runEvents = pgTable(
  "run_events",
  {
    id: text().primaryKey(),
    runId: text()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /**
     * Server-assigned, globally monotonic sequence (bigint identity). Orders
     * events within a run and serves as the SSE `Last-Event-ID` cursor.
     */
    sequence: bigint({ mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    /** Node-assigned per-run sequence, used to de-duplicate resent messages. */
    sourceSequence: integer(),
    type: runEventTypeEnum().notNull(),
    stream: runStreamEnum(),
    message: text(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("run_events_run_id_sequence_idx").on(t.runId, t.sequence),
    uniqueIndex("run_events_run_id_source_sequence_uq")
      .on(t.runId, t.sourceSequence)
      .where(sql`${t.sourceSequence} is not null`),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text().primaryKey(),
    actorType: actorTypeEnum().notNull(),
    actorId: text(),
    action: text().notNull(),
    targetType: text().notNull(),
    targetId: text(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_events_created_at_idx").on(t.createdAt),
    index("audit_events_target_idx").on(t.targetType, t.targetId),
  ],
);
