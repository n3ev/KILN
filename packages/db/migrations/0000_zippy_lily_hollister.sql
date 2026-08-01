CREATE TYPE "public"."account_status" AS ENUM('trialing', 'active', 'past_due', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."archetype" AS ENUM('physical', 'digital', 'service');--> statement-breakpoint
CREATE TYPE "public"."artifact_status" AS ENUM('draft', 'in_review', 'accepted', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('provisioning', 'active', 'suspended', 'transferring', 'released', 'failed');--> statement-breakpoint
CREATE TYPE "public"."autonomy_level" AS ENUM('supervised', 'guided', 'autonomous');--> statement-breakpoint
CREATE TYPE "public"."budget_category" AS ENUM('model', 'image', 'tool', 'external');--> statement-breakpoint
CREATE TYPE "public"."checkpoint_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'auto');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('healthy', 'degraded', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."cost_category" AS ENUM('model', 'image', 'tool', 'external');--> statement-breakpoint
CREATE TYPE "public"."credit_kind" AS ENUM('grant', 'spend', 'refund');--> statement-breakpoint
CREATE TYPE "public"."event_actor" AS ENUM('agent', 'tool', 'human', 'system');--> statement-breakpoint
CREATE TYPE "public"."invocation_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ownership_mode" AS ENUM('managed', 'delegated', 'transferred');--> statement-breakpoint
CREATE TYPE "public"."phase_status" AS ENUM('pending', 'running', 'blocked', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'waiting_on_checkpoint', 'paused', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('running', 'succeeded', 'failed', 'refused');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'member', 'admin');--> statement-breakpoint
CREATE TYPE "public"."venture_status" AS ENUM('draft', 'building', 'live', 'paused', 'archived', 'transferred');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plan_id" uuid,
	"status" "account_status" DEFAULT 'trialing' NOT NULL,
	"autonomy_default" "autonomy_level" DEFAULT 'guided' NOT NULL,
	"stripe_customer_id" text,
	"budget_weekly_cents" integer DEFAULT 0 NOT NULL,
	"break_glass_public_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 60 NOT NULL,
	"last_used_at" bigint,
	"expires_at" bigint,
	"revoked_at" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"auth_uid" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ventures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archetype" "archetype" NOT NULL,
	"status" "venture_status" DEFAULT 'draft' NOT NULL,
	"ownership_mode" "ownership_mode" DEFAULT 'managed' NOT NULL,
	"brief" jsonb NOT NULL,
	"primary_domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"messages" jsonb NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status" "invocation_status" DEFAULT 'running' NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"category" "budget_category" NOT NULL,
	"limit_micros" bigint NOT NULL,
	"reserved_micros" bigint DEFAULT 0 NOT NULL,
	"spent_micros" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"phase_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"prompt" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"status" "checkpoint_status" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decision" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"status" "phase_status" DEFAULT 'pending' NOT NULL,
	"order_index" integer NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" bigserial NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor" "event_actor" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" uuid NOT NULL,
	"playbook_id" text NOT NULL,
	"playbook_version" text NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"autonomy" "autonomy_level" DEFAULT 'guided' NOT NULL,
	"current_phase" text,
	"budget_micros" bigint DEFAULT 0 NOT NULL,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"seed" text NOT NULL,
	"sandbox" boolean DEFAULT true NOT NULL,
	"idempotency_key" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_authorisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"ceiling_micros" bigint NOT NULL,
	"currency" text NOT NULL,
	"quote_id" text NOT NULL,
	"category" "budget_category" NOT NULL,
	"granted_by_user_id" uuid,
	"standing" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_by_tool_call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phase_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"title" text NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"input" jsonb,
	"output_artifact_id" uuid,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"run_id" uuid NOT NULL,
	"tool_id" text NOT NULL,
	"tool_version" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"status" "tool_call_status" DEFAULT 'running' NOT NULL,
	"idempotency_key" text NOT NULL,
	"external_cost_micros" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"sandboxed" boolean DEFAULT true NOT NULL,
	"authorisation_id" uuid,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_id" uuid,
	"status" "artifact_status" DEFAULT 'draft' NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"storage_key" text,
	"quality" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"display_name" text NOT NULL,
	"ownership_mode" "ownership_mode" DEFAULT 'managed' NOT NULL,
	"status" "asset_status" DEFAULT 'provisioning' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provisioned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"asset_id" uuid,
	"status" "connection_status" DEFAULT 'healthy' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"run_id" uuid,
	"tool_id" text NOT NULL,
	"purpose" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"dek_wrapped" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"rotation_policy" text DEFAULT 'manual' NOT NULL,
	"rotated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"category" "cost_category" NOT NULL,
	"ref_id" text,
	"amount_micros" bigint NOT NULL,
	"vendor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"run_id" uuid,
	"delta_micros" bigint NOT NULL,
	"kind" "credit_kind" NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"price_weekly_cents" integer NOT NULL,
	"entitlements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" uuid NOT NULL,
	"day" timestamp with time zone NOT NULL,
	"metric_key" text NOT NULL,
	"value" numeric(20, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"metric_key" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"value" numeric(20, 6) NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dimensions_hash" text DEFAULT '' NOT NULL,
	"currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders_mirror" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"gross_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"customer_ref" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" uuid,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"topic" text NOT NULL,
	"signature_verified" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_storage_key" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"ip" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "break_glass_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venture_id" uuid NOT NULL,
	"recipient_public_key" text NOT NULL,
	"algorithm" text DEFAULT 'x25519-xsalsa20-poly1305' NOT NULL,
	"storage_key" text NOT NULL,
	"signed_url" text,
	"url_expires_at" timestamp with time zone,
	"packet_checksum_sha256" text NOT NULL,
	"emailed_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_waiters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"match_key" text,
	"resolved_payload" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" text DEFAULT '0' NOT NULL,
	"max_attempts" text DEFAULT '3' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ventures" ADD CONSTRAINT "ventures_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_invocations" ADD CONSTRAINT "agent_invocations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_envelopes" ADD CONSTRAINT "budget_envelopes_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_phase_id_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_authorisations" ADD CONSTRAINT "spend_authorisations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_authorisations" ADD CONSTRAINT "spend_authorisations_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_phase_id_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_task_id_tasks_id_fk" FOREIGN KEY ("created_by_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_leases" ADD CONSTRAINT "credential_leases_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_rollups" ADD CONSTRAINT "daily_rollups_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders_mirror" ADD CONSTRAINT "orders_mirror_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_receipts" ADD CONSTRAINT "webhook_receipts_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_packets" ADD CONSTRAINT "break_glass_packets_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_status_idx" ON "accounts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_stripe_customer_idx" ON "accounts" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tokens_hash_idx" ON "mcp_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mcp_tokens_account_idx" ON "mcp_tokens" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_uid_idx" ON "users" USING btree ("auth_uid");--> statement-breakpoint
CREATE INDEX "users_account_idx" ON "users" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ventures_account_idx" ON "ventures" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ventures_status_idx" ON "ventures" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_invocations_task_idx" ON "agent_invocations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "agent_invocations_agent_idx" ON "agent_invocations" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_envelopes_run_category_idx" ON "budget_envelopes" USING btree ("run_id","category");--> statement-breakpoint
CREATE INDEX "checkpoints_run_idx" ON "checkpoints" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "checkpoints_status_idx" ON "checkpoints" USING btree ("status");--> statement-breakpoint
CREATE INDEX "checkpoints_expires_idx" ON "checkpoints" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "phases_run_key_idx" ON "phases" USING btree ("run_id","key");--> statement-breakpoint
CREATE INDEX "phases_run_order_idx" ON "phases" USING btree ("run_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_seq_idx" ON "run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "run_events_run_created_idx" ON "run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "run_events_type_idx" ON "run_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "runs_venture_idx" ON "runs" USING btree ("venture_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_idempotency_idx" ON "runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "spend_auth_run_idx" ON "spend_authorisations" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "spend_auth_quote_idx" ON "spend_authorisations" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "tasks_phase_idx" ON "tasks" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_calls_idempotency_idx" ON "tool_calls" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "tool_calls_run_idx" ON "tool_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "tool_calls_tool_idx" ON "tool_calls" USING btree ("tool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_run_type_version_idx" ON "artifacts" USING btree ("run_id","type","version");--> statement-breakpoint
CREATE INDEX "artifacts_venture_type_idx" ON "artifacts" USING btree ("venture_id","type");--> statement-breakpoint
CREATE INDEX "artifacts_hash_idx" ON "artifacts" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "artifacts_status_idx" ON "artifacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assets_venture_idx" ON "assets" USING btree ("venture_id");--> statement-breakpoint
CREATE INDEX "assets_kind_idx" ON "assets" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "assets_provider_external_idx" ON "assets" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "connections_venture_idx" ON "connections" USING btree ("venture_id");--> statement-breakpoint
CREATE INDEX "connections_status_idx" ON "connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credential_leases_credential_idx" ON "credential_leases" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "credential_leases_run_idx" ON "credential_leases" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "credentials_asset_idx" ON "credentials" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "credentials_expires_idx" ON "credentials" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "cost_ledger_run_idx" ON "cost_ledger" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "cost_ledger_category_idx" ON "cost_ledger" USING btree ("category");--> statement-breakpoint
CREATE INDEX "cost_ledger_created_idx" ON "cost_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_account_idx" ON "credit_ledger" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_run_idx" ON "credit_ledger" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_name_idx" ON "plans" USING btree ("name");--> statement-breakpoint
CREATE INDEX "subscriptions_account_idx" ON "subscriptions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_idx" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_rollups_unique_idx" ON "daily_rollups" USING btree ("venture_id","day","metric_key");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshots_unique_idx" ON "metric_snapshots" USING btree ("venture_id","provider","metric_key","ts","dimensions_hash");--> statement-breakpoint
CREATE INDEX "metric_snapshots_venture_key_ts_idx" ON "metric_snapshots" USING btree ("venture_id","metric_key","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_mirror_provider_external_idx" ON "orders_mirror" USING btree ("venture_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "orders_mirror_venture_placed_idx" ON "orders_mirror" USING btree ("venture_id","placed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_receipts_provider_event_idx" ON "webhook_receipts" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE INDEX "webhook_receipts_venture_idx" ON "webhook_receipts" USING btree ("venture_id");--> statement-breakpoint
CREATE INDEX "audit_log_account_idx" ON "audit_log" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "break_glass_venture_idx" ON "break_glass_packets" USING btree ("venture_id");--> statement-breakpoint
CREATE INDEX "event_waiters_lookup_idx" ON "event_waiters" USING btree ("event_name","match_key");--> statement-breakpoint
CREATE INDEX "event_waiters_run_idx" ON "event_waiters" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "job_queue_claim_idx" ON "job_queue" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "job_queue_name_idx" ON "job_queue" USING btree ("name");