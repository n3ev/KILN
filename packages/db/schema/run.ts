import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  autonomyLevel,
  budgetCategory,
  checkpointStatus,
  createdAt,
  eventActor,
  invocationStatus,
  phaseStatus,
  runStatus,
  taskStatus,
  toolCallStatus,
} from "./_shared.js";
import { users } from "./identity.js";
import { ventures } from "./venture.js";

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id")
      .notNull()
      .references(() => ventures.id, { onDelete: "cascade" }),
    playbookId: text("playbook_id").notNull(),
    playbookVersion: text("playbook_version").notNull(),
    status: runStatus("status").notNull().default("queued"),
    autonomy: autonomyLevel("autonomy").notNull().default("guided"),
    currentPhase: text("current_phase"),
    budgetMicros: bigint("budget_micros", { mode: "number" }).notNull().default(0),
    spentMicros: bigint("spent_micros", { mode: "number" }).notNull().default(0),
    /** Makes all sampling, shuffling, and mock behaviour reproducible. */
    seed: text("seed").notNull(),
    /** Every tool routed to simulate() for this run. */
    sandbox: boolean("sandbox").notNull().default(true),
    idempotencyKey: text("idempotency_key"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("runs_venture_idx").on(t.ventureId),
    index("runs_status_idx").on(t.status),
    uniqueIndex("runs_idempotency_idx").on(t.idempotencyKey),
  ],
);

/**
 * The event log — the source of truth for a run.
 *
 * Append-only, enforced by a trigger in policies/0002_append_only.sql rather
 * than by convention, because "we agreed not to update this table" is not a
 * guarantee you can replay against. `seq` is unique per run and gives the fold
 * a deterministic order that `created_at` cannot (two events can share a ms).
 */
export const runEvents = pgTable(
  "run_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    actor: eventActor("actor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("run_events_run_seq_idx").on(t.runId, t.seq),
    index("run_events_run_created_idx").on(t.runId, t.createdAt),
    index("run_events_type_idx").on(t.type),
  ],
);

/** Read-model projection. Rebuildable from run_events at any time. */
export const phases = pgTable(
  "phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    status: phaseStatus("status").notNull().default("pending"),
    orderIndex: integer("order_index").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("phases_run_key_idx").on(t.runId, t.key), index("phases_run_order_idx").on(t.runId, t.orderIndex)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phaseId: uuid("phase_id")
      .notNull()
      .references(() => phases.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    title: text("title").notNull(),
    status: taskStatus("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(1),
    input: jsonb("input"),
    outputArtifactId: uuid("output_artifact_id"),
    error: jsonb("error"),
    createdAt: createdAt(),
  },
  (t) => [index("tasks_phase_idx").on(t.phaseId), index("tasks_status_idx").on(t.status)],
);

export const checkpoints = pgTable(
  "checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    phaseId: uuid("phase_id").references(() => phases.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    prompt: jsonb("prompt").notNull(),
    options: jsonb("options").notNull(),
    status: checkpointStatus("status").notNull().default("pending"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decision: jsonb("decision"),
    /** Default 72h. Expiry behaviour depends on the run's autonomy level. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("checkpoints_run_idx").on(t.runId),
    index("checkpoints_status_idx").on(t.status),
    index("checkpoints_expires_idx").on(t.expiresAt),
  ],
);

export const agentInvocations = pgTable(
  "agent_invocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    /** Full message trace, already passed through redaction. */
    messages: jsonb("messages").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    status: invocationStatus("status").notNull().default("running"),
    error: jsonb("error"),
    createdAt: createdAt(),
  },
  (t) => [index("agent_invocations_task_idx").on(t.taskId), index("agent_invocations_agent_idx").on(t.agentId)],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    toolId: text("tool_id").notNull(),
    toolVersion: text("tool_version").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    status: toolCallStatus("status").notNull().default("running"),
    /** hash(runId, toolId, canonicalInput) — see tools/core/canonical.ts. */
    idempotencyKey: text("idempotency_key").notNull(),
    externalCostMicros: bigint("external_cost_micros", { mode: "number" }).notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    sandboxed: boolean("sandboxed").notNull().default(true),
    authorisationId: uuid("authorisation_id"),
    error: jsonb("error"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("tool_calls_idempotency_idx").on(t.idempotencyKey),
    index("tool_calls_run_idx").on(t.runId),
    index("tool_calls_tool_idx").on(t.toolId),
  ],
);

/**
 * Two-phase spend — CLAUDE.md §9.3. A `spend` tool refuses to execute without
 * a row here whose ceiling covers the actual price and whose quote id matches.
 */
export const spendAuthorisations = pgTable(
  "spend_authorisations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    ceilingMicros: bigint("ceiling_micros", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    quoteId: text("quote_id").notNull(),
    category: budgetCategory("category").notNull(),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    standing: boolean("standing").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedByToolCallId: uuid("consumed_by_tool_call_id"),
    createdAt: createdAt(),
  },
  (t) => [index("spend_auth_run_idx").on(t.runId), index("spend_auth_quote_idx").on(t.quoteId)],
);

export const budgetEnvelopes = pgTable(
  "budget_envelopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    category: budgetCategory("category").notNull(),
    limitMicros: bigint("limit_micros", { mode: "number" }).notNull(),
    reservedMicros: bigint("reserved_micros", { mode: "number" }).notNull().default(0),
    spentMicros: bigint("spent_micros", { mode: "number" }).notNull().default(0),
  },
  (t) => [uniqueIndex("budget_envelopes_run_category_idx").on(t.runId, t.category)],
);

export const runsRelations = relations(runs, ({ one, many }) => ({
  venture: one(ventures, { fields: [runs.ventureId], references: [ventures.id] }),
  events: many(runEvents),
  phases: many(phases),
  checkpoints: many(checkpoints),
}));

export const phasesRelations = relations(phases, ({ one, many }) => ({
  run: one(runs, { fields: [phases.runId], references: [runs.id] }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  phase: one(phases, { fields: [tasks.phaseId], references: [phases.id] }),
  invocations: many(agentInvocations),
  toolCalls: many(toolCalls),
}));
