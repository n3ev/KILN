import type {
  ArtifactId,
  BudgetEnvelope,
  CheckpointId,
  PhaseState,
  RunEvent,
  RunEventRecord,
  RunState,
  TaskState,
} from "@kiln/contracts";
import { InvariantViolated } from "@kiln/contracts";

/**
 * The fold — CLAUDE.md §8.1.
 *
 * `run_events` is the source of truth. Current state is a PURE function of the
 * event log: `reduce(events) -> RunState`. The `phases` and `tasks` tables are
 * read-model projections that can be dropped and rebuilt from here at any time.
 *
 * Two properties this file must preserve, because everything else depends on
 * them:
 *
 *   1. **Purity.** No clock, no randomness, no I/O. Replaying the same events
 *      must produce byte-identical state, on any machine, at any time.
 *   2. **Totality.** Every event variant is handled. The exhaustiveness check
 *      at the bottom of the switch turns "someone added an event and forgot to
 *      fold it" into a compile error rather than a silent state divergence.
 */

export interface FoldSeed {
  readonly runId: RunState["runId"];
  readonly ventureId: RunState["ventureId"];
}

function emptyState(seed: FoldSeed): RunState {
  return {
    runId: seed.runId,
    ventureId: seed.ventureId,
    playbookId: "",
    playbookVersion: "",
    status: "queued",
    autonomy: "guided",
    seed: "",
    phases: [],
    tasks: [],
    artifactsByType: {},
    pendingCheckpointIds: [],
    humanDirectives: [],
    grantedScopes: [],
    budgets: [],
    spentMicros: 0,
    degraded: false,
    lastSeq: 0,
  };
}

const replacePhase = (phases: PhaseState[], id: string, patch: Partial<PhaseState>): PhaseState[] =>
  phases.map((p) => (p.id === id ? { ...p, ...patch } : p));

const replaceTask = (tasks: TaskState[], id: string, patch: Partial<TaskState>): TaskState[] =>
  tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));

function adjustBudget(
  budgets: BudgetEnvelope[],
  category: BudgetEnvelope["category"],
  patch: (e: BudgetEnvelope) => BudgetEnvelope,
): BudgetEnvelope[] {
  const existing = budgets.find((b) => b.category === category);
  if (!existing) {
    return [...budgets, patch({ category, limitMicros: 0, reservedMicros: 0, spentMicros: 0 })];
  }
  return budgets.map((b) => (b.category === category ? patch(b) : b));
}

/** Applies one event. Exported so tests can exercise transitions individually. */
export function apply(state: RunState, event: RunEvent, createdAt: string): RunState {
  switch (event.type) {
    case "run.started":
      return {
        ...state,
        status: "running",
        playbookId: event.playbookId,
        playbookVersion: event.playbookVersion,
        autonomy: event.autonomy,
        seed: event.seed,
        budgets: state.budgets.length > 0 ? state.budgets : [],
      };

    case "run.autonomy_changed":
      // Takes effect at the next phase boundary; the runtime enforces that, but
      // the folded value is the operative one from here on.
      return { ...state, autonomy: event.to };

    case "run.paused":
      return { ...state, status: "paused" };
    case "run.resumed":
      return { ...state, status: "running" };
    case "run.cancelled":
      return { ...state, status: "cancelled" };
    case "run.succeeded":
      return { ...state, status: "succeeded" };
    case "run.failed":
      return { ...state, status: "failed" };

    case "phase.started":
      return {
        ...state,
        status: state.status === "waiting_on_checkpoint" ? "running" : state.status,
        currentPhaseKey: event.key,
        phases: state.phases.some((p) => p.id === event.phaseId)
          ? replacePhase(state.phases, event.phaseId, { status: "running", startedAt: createdAt })
          : [
              ...state.phases,
              {
                id: event.phaseId,
                key: event.key,
                title: event.title,
                status: "running",
                orderIndex: state.phases.length,
                startedAt: createdAt,
              },
            ],
      };

    case "phase.succeeded":
      return { ...state, phases: replacePhase(state.phases, event.phaseId, { status: "succeeded", endedAt: createdAt }) };
    case "phase.failed":
      return { ...state, phases: replacePhase(state.phases, event.phaseId, { status: "failed", endedAt: createdAt }) };
    case "phase.skipped":
      return { ...state, phases: replacePhase(state.phases, event.phaseId, { status: "skipped", endedAt: createdAt }) };

    case "task.started": {
      const existing = state.tasks.find((t) => t.id === event.taskId);
      return {
        ...state,
        tasks: existing
          ? replaceTask(state.tasks, event.taskId, { status: "running", attempt: event.attempt })
          : [
              ...state.tasks,
              {
                id: event.taskId,
                phaseId: event.phaseId,
                agentId: event.agentId,
                title: event.title,
                status: "running",
                attempt: event.attempt,
              },
            ],
      };
    }

    case "task.succeeded":
      return {
        ...state,
        tasks: replaceTask(state.tasks, event.taskId, {
          status: "succeeded",
          ...(event.artifactId ? { artifactId: event.artifactId } : {}),
        }),
      };

    case "task.failed":
      return { ...state, tasks: replaceTask(state.tasks, event.taskId, { status: "failed", error: event.error }) };

    case "artifact.written":
      // Latest version of a type wins; supersession is recorded separately.
      return {
        ...state,
        artifactsByType: { ...state.artifactsByType, [event.artifactType]: event.artifactId },
      };

    case "artifact.superseded":
      return state;

    case "checkpoint.requested":
      return {
        ...state,
        status: "waiting_on_checkpoint",
        pendingCheckpointIds: [...state.pendingCheckpointIds, event.checkpointId],
      };

    case "checkpoint.decided": {
      const pending = state.pendingCheckpointIds.filter((id) => id !== event.checkpointId);
      if (event.status === "rejected") {
        return { ...state, pendingCheckpointIds: pending, status: "paused" };
      }
      return {
        ...state,
        pendingCheckpointIds: pending,
        // Only resume when nothing else is still blocking.
        status: pending.length === 0 && state.status === "waiting_on_checkpoint" ? "running" : state.status,
      };
    }

    case "human_directive":
      if (state.humanDirectives.some((directive) => directive.directiveId === event.directiveId)) return state;
      return {
        ...state,
        humanDirectives: [
          ...state.humanDirectives,
          {
            directiveId: event.directiveId,
            directive: event.directive,
            byUserId: event.byUserId,
            applyAt: event.applyAt,
            ...(event.receivedPhaseKey ? { receivedPhaseKey: event.receivedPhaseKey } : {}),
            submittedAt: createdAt,
            status: "queued",
          },
        ],
      };

    case "human_directive.applied": {
      const queued = state.humanDirectives.find((directive) => directive.directiveId === event.directiveId);
      if (!queued) {
        throw new InvariantViolated("a human directive was applied before it was submitted", {
          directiveId: event.directiveId,
        });
      }
      return {
        ...state,
        humanDirectives: state.humanDirectives.map((directive) =>
          directive.directiveId === event.directiveId
            ? {
                ...directive,
                status: "applied" as const,
                appliedPhaseKey: event.phaseKey,
                appliedAt: createdAt,
              }
            : directive,
        ),
      };
    }

    case "budget.reserved":
      return {
        ...state,
        budgets: adjustBudget(state.budgets, event.category, (b) => ({
          ...b,
          reservedMicros: b.reservedMicros + event.micros,
        })),
      };

    case "budget.settled":
      return {
        ...state,
        spentMicros: state.spentMicros + event.actualMicros,
        budgets: adjustBudget(state.budgets, event.category, (b) => ({
          ...b,
          reservedMicros: Math.max(0, b.reservedMicros - event.reservedMicros),
          spentMicros: b.spentMicros + event.actualMicros,
        })),
      };

    case "agent.completed":
      return { ...state, spentMicros: state.spentMicros + event.costMicros };

    case "provider.degraded":
      // Sticky: once a run has been served by a fallback, artifacts built after
      // that point carry quality.degraded and the customer is told.
      return { ...state, degraded: true };

    // Events that are recorded for the timeline and cost ledger but do not
    // change folded run state.
    case "agent.invoked":
    case "agent.token":
    case "tool.called":
    case "tool.succeeded":
    case "tool.failed":
    case "critic.rejected":
    case "critic.passed":
    case "lint.blocked":
    case "spend.authorised":
    case "quality.evaluated":
    case "quality.overridden":
    case "memo.appended":
    case "notice":
      return state;

    default: {
      // Exhaustiveness: adding a RunEvent variant without folding it is a
      // compile error here, not a runtime surprise in production.
      const unreachable: never = event;
      throw new InvariantViolated(`unhandled run event`, { event: unreachable });
    }
  }
}

/**
 * Folds an event log into run state.
 *
 * Records must arrive ordered by `seq`. Out-of-order or duplicated sequences
 * are a corruption of the log rather than something to paper over, so they
 * throw rather than being sorted silently — silently reordering would mask the
 * bug that produced them.
 */
export function fold(seed: FoldSeed, records: readonly RunEventRecord[]): RunState {
  let state = emptyState(seed);
  let previousSeq = -1;

  for (const record of records) {
    if (record.seq <= previousSeq) {
      throw new InvariantViolated("run events are out of order or duplicated", {
        runId: seed.runId,
        seq: record.seq,
        previousSeq,
      });
    }
    previousSeq = record.seq;
    state = apply(state, record.payload, record.createdAt);
    state = { ...state, lastSeq: record.seq };
  }

  return state;
}

/** Convenience for the UI: the phase currently running, if any. */
export function activePhase(state: RunState): PhaseState | undefined {
  return state.phases.find((p) => p.status === "running");
}

export function isBlocked(state: RunState): boolean {
  return state.status === "waiting_on_checkpoint" && state.pendingCheckpointIds.length > 0;
}

/** Percentage complete, for the Run Theatre's progress indicator. */
export function progress(state: RunState): number {
  if (state.phases.length === 0) return 0;
  const done = state.phases.filter((p) => p.status === "succeeded" || p.status === "skipped").length;
  return Math.round((done / state.phases.length) * 100);
}

export function artifactIdFor(state: RunState, type: string): ArtifactId | undefined {
  return state.artifactsByType[type] as ArtifactId | undefined;
}

export function pendingCheckpoints(state: RunState): CheckpointId[] {
  return [...state.pendingCheckpointIds];
}
