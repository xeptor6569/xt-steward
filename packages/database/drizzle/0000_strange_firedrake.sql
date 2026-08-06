CREATE TYPE "public"."actor_type" AS ENUM('user', 'node', 'system');--> statement-breakpoint
CREATE TYPE "public"."agent_type" AS ENUM('diagnostic');--> statement-breakpoint
CREATE TYPE "public"."node_status" AS ENUM('online', 'offline');--> statement-breakpoint
CREATE TYPE "public"."run_event_type" AS ENUM('log', 'notice', 'state');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'dispatching', 'running', 'succeeded', 'failed', 'cancellation_requested', 'cancelled', 'timed_out', 'lost');--> statement-breakpoint
CREATE TYPE "public"."run_stream" AS ENUM('stdout', 'stderr');--> statement-breakpoint
CREATE TYPE "public"."run_type" AS ENUM('diagnostic');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "agent_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"external_key" text NOT NULL,
	"type" "agent_type" NOT NULL,
	"name" text NOT NULL,
	"version" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_enrollment_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"name" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_enrollment_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "node_status" DEFAULT 'offline' NOT NULL,
	"version" text,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_hash" text NOT NULL,
	"last_connected_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"max_concurrent_runs" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_name_unique" UNIQUE("name"),
	CONSTRAINT "nodes_credentialHash_unique" UNIQUE("credential_hash")
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "run_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_sequence" integer,
	"type" "run_event_type" NOT NULL,
	"stream" "run_stream",
	"message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"node_id" text NOT NULL,
	"agent_definition_id" text,
	"type" "run_type" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"task" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"exit_code" integer,
	"error_code" text,
	"error_message" text,
	"cancellation_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"external_key" text NOT NULL,
	"name" text NOT NULL,
	"local_path" text NOT NULL,
	"repository_url" text,
	"default_branch" text,
	"read_only" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_enrollment_tokens" ADD CONSTRAINT "node_enrollment_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_definition_id_agent_definitions_id_fk" FOREIGN KEY ("agent_definition_id") REFERENCES "public"."agent_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_definitions_node_id_external_key_uq" ON "agent_definitions" USING btree ("node_id","external_key");--> statement-breakpoint
CREATE INDEX "agent_definitions_node_id_idx" ON "agent_definitions" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "node_enrollment_tokens_expires_at_idx" ON "node_enrollment_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "nodes_status_idx" ON "nodes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "run_events_run_id_sequence_idx" ON "run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_id_source_sequence_uq" ON "run_events" USING btree ("run_id","source_sequence") WHERE "run_events"."source_sequence" is not null;--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runs_node_id_status_idx" ON "runs" USING btree ("node_id","status");--> statement-breakpoint
CREATE INDEX "runs_workspace_id_idx" ON "runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "runs_created_at_idx" ON "runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_node_id_external_key_uq" ON "workspaces" USING btree ("node_id","external_key");--> statement-breakpoint
CREATE INDEX "workspaces_node_id_idx" ON "workspaces" USING btree ("node_id");