import { z } from "zod";
import { ArtifactType } from "./artifact.js";
import {
  ArtifactId,
  AuthorisationId,
  Autonomy,
  CheckpointId,
  Currency,
  DirectiveId,
  Micros,
  PhaseId,
  RunId,
  TaskId,
  Timestamp,
  UserId,
  VentureId,
} from "./primitives.js";
import { Scope } from "./scopes.js";

/** Agent identities. Playbooks reference these; the roster implements them. */
export const AgentId = z.enum([
  "interviewer",
  "analyst",
  "strategist",
  "brand-director",
  "product-architect",
  "supply-officer",
  "storefront-engineer",
  "content-studio",
  "growth-engineer",
  "compliance-officer",
  "critic",
  "operator",
  "planner",
  "repair",
]);
export type AgentId = z.infer<typeof AgentId>;

export const RunStatus = z.enum([
  "queued",
  "running",
  "waiting_on_checkpoint",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const PhaseStatus = z.enum(["pending", "running", "blocked", "succeeded", "failed", "skipped"]);
export const TaskStatus = z.enum(["pending", "running", "succeeded", "failed", "abandoned"]);

/** The shared phase spine of CLAUDE.md §11.1. Playbooks specialise the middle. */
export const PhaseKey = z.enum([
  "intake",
  "validation",
  "strategy",
  "identity",
  "offer",
  "infrastructure",
  "build",
  "content",
  "compliance",
  "qa",
  "launch",
  "operate",
]);
export type PhaseKey = z.infer<typeof PhaseKey>;

export const CheckpointKind = z.enum([
  "hard_gate",
  "spend_authorisation",
  "quality_override",
  "reconnect",
  "archetype_ambiguous",
  "critic_escalation",
  "repair_escalation",
  "kill_recommendation",
]);
export type CheckpointKind = z.infer<typeof CheckpointKind>;

export const CheckpointStatus = z.enum(["pending", "approved", "rejected", "expired", "auto"]);

export const CheckpointOption = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  /** Marks the option KILN recommends. The UI leads with it. */
  recommended: z.boolean().default(false),
  consequence: z.string().min(1),
});

export const Checkpoint = z.object({
  id: CheckpointId,
  runId: RunId,
  phaseId: PhaseId.optional(),
  kind: CheckpointKind,
  title: z.string().min(1),
  /** What the customer is being asked, and what they need to know to answer. */
  prompt: z.object({
    question: z.string().min(1),
    context: z.string().min(1),
    artifactIds: z.array(ArtifactId).default([]),
    /** Autonomous hard gates cannot proceed before this veto deadline. */
    notBefore: Timestamp.optional(),
  }),
  options: z.array(CheckpointOption).min(1),
  status: CheckpointStatus,
  decidedByUserId: UserId.optional(),
  decision: z.object({ optionId: z.string(), note: z.string().optional() }).optional(),
  /** Default 72h. Expiry behaviour depends on the run's autonomy level. */
  expiresAt: Timestamp,
  createdAt: Timestamp,
  decidedAt: Timestamp.optional(),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

/**
 * Two-phase spend — CLAUDE.md §9.3. A commit tool accepts only an
 * authorisation id, and refuses if the actual price exceeds the ceiling, if the
 * authorisation expired, or if the quote id does not match.
 */
export const SpendAuthorisation = z.object({
  id: AuthorisationId,
  runId: RunId,
  purpose: z.string().min(1),
  ceilingMicros: Micros,
  currency: Currency,
  /** Ties this authorisation to the exact quote it was granted against. */
  quoteId: z.string().min(1),
  category: z.enum(["model", "image", "tool", "external"]),
  grantedByUserId: UserId.optional(),
  /** True when covered by a standing authorisation signed at run start. */
  standing: z.boolean().default(false),
  expiresAt: Timestamp,
  consumedByToolCallId: z.string().optional(),
  createdAt: Timestamp,
});
export type SpendAuthorisation = z.infer<typeof SpendAuthorisation>;

export const BudgetCategory = z.enum(["model", "image", "tool", "external"]);
export type BudgetCategory = z.infer<typeof BudgetCategory>;

export const BudgetEnvelope = z.object({
  category: BudgetCategory,
  limitMicros: Micros,
  reservedMicros: Micros,
  spentMicros: Micros,
});
export type BudgetEnvelope = z.infer<typeof BudgetEnvelope>;

// ── The event log ────────────────────────────────────────────────────────────

export const EventActor = z.enum(["agent", "tool", "human", "system"]);

export const HumanDirectiveApplyAt = z.enum(["current_phase", "next_phase"]);
export type HumanDirectiveApplyAt = z.infer<typeof HumanDirectiveApplyAt>;

export const HumanDirectiveRequest = z.object({
  directiveId: DirectiveId,
  directive: z.string().trim().min(3).max(1_000),
}).strict();
export type HumanDirectiveRequest = z.infer<typeof HumanDirectiveRequest>;

export const HumanDirectiveReceipt = z.object({
  eventId: z.string().uuid(),
  directiveId: DirectiveId,
  runId: RunId,
  seq: z.number().int().nonnegative(),
  applyAt: HumanDirectiveApplyAt,
  receivedPhaseKey: z.string().min(1).optional(),
  status: z.literal("queued"),
  submittedAt: Timestamp,
});
export type HumanDirectiveReceipt = z.infer<typeof HumanDirectiveReceipt>;

/**
 * Every event that can occur in a run.
 *
 * `run_events` is the source of truth; phases and tasks are read-model
 * projections rebuilt by folding this union. Adding a variant here is the only
 * way to add run state — nothing else may write derived state as truth.
 */
export const RunEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.started"),
    playbookId: z.string(),
    playbookVersion: z.string(),
    autonomy: Autonomy,
    seed: z.string(),
    budgetMicros: Micros,
  }),
  z.object({ type: z.literal("run.autonomy_changed"), from: Autonomy, to: Autonomy, byUserId: UserId }),
  z.object({ type: z.literal("run.paused"), reason: z.string() }),
  z.object({ type: z.literal("run.resumed") }),
  z.object({ type: z.literal("run.cancelled"), reason: z.string(), byUserId: UserId.optional() }),
  z.object({ type: z.literal("run.succeeded") }),
  z.object({ type: z.literal("run.failed"), error: z.record(z.string(), z.unknown()) }),

  z.object({ type: z.literal("phase.started"), phaseId: PhaseId, key: z.string(), title: z.string() }),
  z.object({ type: z.literal("phase.succeeded"), phaseId: PhaseId }),
  z.object({ type: z.literal("phase.failed"), phaseId: PhaseId, error: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("phase.skipped"), phaseId: PhaseId, reason: z.string() }),

  z.object({
    type: z.literal("task.started"),
    taskId: TaskId,
    phaseId: PhaseId,
    agentId: AgentId,
    title: z.string(),
    attempt: z.number().int().positive(),
  }),
  z.object({ type: z.literal("task.succeeded"), taskId: TaskId, artifactId: ArtifactId.optional() }),
  z.object({ type: z.literal("task.failed"), taskId: TaskId, error: z.record(z.string(), z.unknown()) }),

  z.object({
    type: z.literal("agent.invoked"),
    taskId: TaskId,
    agentId: AgentId,
    model: z.string(),
    provider: z.string(),
  }),
  z.object({
    type: z.literal("agent.completed"),
    taskId: TaskId,
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    costMicros: Micros,
    latencyMs: z.number().int().nonnegative(),
  }),
  /** Streamed model output, for the Run Theatre. Not replayed as state. */
  z.object({ type: z.literal("agent.token"), taskId: TaskId, text: z.string() }),

  z.object({
    type: z.literal("tool.called"),
    taskId: TaskId.optional(),
    toolCallId: z.string(),
    toolId: z.string(),
    sandboxed: z.boolean(),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal("tool.succeeded"),
    toolCallId: z.string(),
    latencyMs: z.number().int().nonnegative(),
    costMicros: Micros.default(0),
  }),
  z.object({ type: z.literal("tool.failed"), toolCallId: z.string(), error: z.record(z.string(), z.unknown()) }),

  z.object({ type: z.literal("artifact.written"), artifactId: ArtifactId, artifactType: ArtifactType, version: z.number().int() }),
  z.object({ type: z.literal("artifact.superseded"), artifactId: ArtifactId, bySupersedingId: ArtifactId }),

  z.object({ type: z.literal("critic.rejected"), artifactId: ArtifactId, cycle: z.number().int(), summary: z.string() }),
  z.object({ type: z.literal("critic.passed"), artifactId: ArtifactId, cycle: z.number().int() }),
  z.object({ type: z.literal("lint.blocked"), taskId: TaskId, ruleCount: z.number().int(), cycle: z.number().int() }),

  z.object({ type: z.literal("checkpoint.requested"), checkpointId: CheckpointId, kind: CheckpointKind, title: z.string() }),
  z.object({
    type: z.literal("checkpoint.decided"),
    checkpointId: CheckpointId,
    status: CheckpointStatus,
    optionId: z.string().optional(),
    byUserId: UserId.optional(),
  }),

  z.object({ type: z.literal("spend.authorised"), authorisationId: AuthorisationId, ceilingMicros: Micros, purpose: z.string() }),
  z.object({
    type: z.literal("budget.reserved"),
    category: BudgetCategory,
    micros: Micros,
    ref: z.string(),
  }),
  z.object({ type: z.literal("budget.settled"), category: BudgetCategory, reservedMicros: Micros, actualMicros: Micros, ref: z.string() }),

  z.object({ type: z.literal("quality.evaluated"), passed: z.boolean(), failedGates: z.array(z.string()) }),
  z.object({ type: z.literal("quality.overridden"), gate: z.string(), byUserId: UserId, reason: z.string() }),

  z.object({
    /** Kept verbatim because the public Run Theatre contract names this event. */
    type: z.literal("human_directive"),
    directiveId: DirectiveId,
    directive: z.string().trim().min(3).max(1_000),
    byUserId: UserId,
    applyAt: HumanDirectiveApplyAt,
    receivedPhaseKey: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("human_directive.applied"),
    directiveId: DirectiveId,
    phaseKey: z.string().min(1),
    appliedByAgentId: z.literal("planner"),
  }),

  z.object({ type: z.literal("memo.appended"), phase: z.string(), decision: z.string() }),
  z.object({ type: z.literal("provider.degraded"), from: z.string(), to: z.string(), reason: z.string() }),
  z.object({ type: z.literal("notice"), level: z.enum(["info", "warn", "error"]), message: z.string() }),
]);
export type RunEvent = z.infer<typeof RunEvent>;
export type RunEventType = RunEvent["type"];

/** The persisted envelope. `seq` is unique per run and strictly increasing. */
export const RunEventRecord = z.object({
  id: z.string().uuid(),
  runId: RunId,
  seq: z.number().int().nonnegative(),
  actor: EventActor,
  payload: RunEvent,
  createdAt: Timestamp,
});
export type RunEventRecord = z.infer<typeof RunEventRecord>;

// ── Folded state ─────────────────────────────────────────────────────────────

export const HumanDirectiveState = z.object({
  directiveId: DirectiveId,
  directive: z.string().min(3).max(1_000),
  byUserId: UserId,
  applyAt: HumanDirectiveApplyAt,
  receivedPhaseKey: z.string().min(1).optional(),
  submittedAt: Timestamp,
  status: z.enum(["queued", "applied"]),
  appliedPhaseKey: z.string().min(1).optional(),
  appliedAt: Timestamp.optional(),
});
export type HumanDirectiveState = z.infer<typeof HumanDirectiveState>;

export const PhaseState = z.object({
  id: PhaseId,
  key: z.string(),
  title: z.string(),
  status: PhaseStatus,
  orderIndex: z.number().int().nonnegative(),
  startedAt: Timestamp.optional(),
  endedAt: Timestamp.optional(),
});

export const TaskState = z.object({
  id: TaskId,
  phaseId: PhaseId,
  agentId: AgentId,
  title: z.string(),
  status: TaskStatus,
  attempt: z.number().int().positive(),
  artifactId: ArtifactId.optional(),
  error: z.record(z.string(), z.unknown()).optional(),
});

/**
 * The pure fold of the event log. Never persisted as truth — always derivable.
 * `reduce(events) -> RunState` is the only way this is constructed.
 */
export const RunState = z.object({
  runId: RunId,
  ventureId: VentureId,
  playbookId: z.string(),
  playbookVersion: z.string(),
  status: RunStatus,
  autonomy: Autonomy,
  seed: z.string(),
  currentPhaseKey: z.string().optional(),
  phases: z.array(PhaseState).default([]),
  tasks: z.array(TaskState).default([]),
  artifactsByType: z.record(z.string(), ArtifactId).default({}),
  pendingCheckpointIds: z.array(CheckpointId).default([]),
  humanDirectives: z.array(HumanDirectiveState).default([]),
  grantedScopes: z.array(Scope).default([]),
  budgets: z.array(BudgetEnvelope).default([]),
  spentMicros: Micros.default(0),
  degraded: z.boolean().default(false),
  lastSeq: z.number().int().nonnegative().default(0),
});
export type RunState = z.infer<typeof RunState>;
export type PhaseState = z.infer<typeof PhaseState>;
export type TaskState = z.infer<typeof TaskState>;

export function isTerminal(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/** Artifact types this run has produced, for playbook dependency checks. */
export function producedTypes(state: RunState): ArtifactType[] {
  return Object.keys(state.artifactsByType) as ArtifactType[];
}
