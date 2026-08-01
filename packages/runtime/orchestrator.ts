import {
  ComplianceBlocked,
  ComplianceReport,
  InvariantViolated,
  QualityGateFailed,
  QualityReport,
  dispositionOf,
  isKilnError,
  type ArtifactType,
} from "@kiln/contracts";
import { logger } from "@kiln/observability";
import type { GateDef, Playbook, PhaseDef } from "@kiln/playbooks";
import { runArtifactTask } from "./artifact-runner.js";
import { runCompliancePreflight } from "./compliance-preflight.js";
import { routeHumanDirectivesAtBoundary } from "./directives.js";
import { qualityFailures } from "./quality-runner.js";
import type { OrchestratorDeps, RunContextState } from "./runtime-types.js";
import { emitTracked, refreshAtBoundary, stableRuntimeId } from "./tracking.js";

export type { OrchestratorDeps, QualityEvidence, RunContextState } from "./runtime-types.js";
export { MAX_REPAIR_CYCLES } from "./artifact-runner.js";

const MAX_PHASE_ATTEMPTS = 2;

function errorRecord(error: unknown): Record<string, unknown> {
  return isKilnError(error) ? error.toJSON() : { name: error instanceof Error ? error.name : "Error", message: String(error) };
}

async function escalatePhaseFailure(
  deps: OrchestratorDeps,
  phase: PhaseDef,
  error: unknown,
): Promise<void> {
  await deps.requestCheckpoint({
    kind: "repair_escalation",
    title: `${phase.title} needs intervention`,
    question: "This phase could not produce its required artifacts. Stop here and review the failure?",
    context: JSON.stringify(errorRecord(error)),
    options: [
      {
        id: "stop",
        label: "Stop and review",
        description: "Keep the run blocked while the failure is investigated.",
        consequence: "No downstream phase starts with a missing artifact.",
        recommended: true,
      },
      {
        id: "retry-later",
        label: "Retry later",
        description: "Resume this same phase after its input or dependency is corrected.",
        consequence: "The run remains blocked until it is resumed explicitly.",
        recommended: false,
      },
    ],
  });
}

function assertCompliance(content: unknown): void {
  const report = ComplianceReport.safeParse(content);
  if (report.success && report.data.status === "blocked") {
    throw new ComplianceBlocked(report.data.blockingFindings);
  }
}

function assertQuality(content: unknown): void {
  const report = QualityReport.safeParse(content);
  if (!report.success) {
    throw new QualityGateFailed([
      { gate: "quality-report", assertion: "a valid quality report exists", detail: "missing or invalid quality_report artifact" },
    ]);
  }
  if (!report.data.clearedForLaunch) throw new QualityGateFailed(qualityFailures(report.data));
}

async function executePhaseAttempt(
  deps: OrchestratorDeps,
  initial: RunContextState,
  playbook: Playbook,
  phase: PhaseDef,
  attempt: number,
): Promise<RunContextState> {
  const phaseId = stableRuntimeId(initial.state.runId, "phase", phase.key);
  let run = await emitTracked(
    deps,
    initial,
    { type: "phase.started", phaseId: phaseId as never, key: phase.key, title: phase.title },
    "system",
  );

  if (phase.optional?.(run.state, run.brief)) {
    return emitTracked(
      deps,
      run,
      { type: "phase.skipped", phaseId: phaseId as never, reason: "playbook marked it optional for this brief" },
      "system",
    );
  }

  if (phase.key === "intake") {
    run = await runCompliancePreflight(deps, run, phase, phaseId);
  }

  for (const type of phase.produces) {
    if (run.state.artifactsByType[type] !== undefined && run.artifacts[type] !== undefined) {
      if (type === "compliance_report") assertCompliance(run.artifacts[type]);
      if (type === "quality_report") assertQuality(run.artifacts[type]);
      continue;
    }
    const task = await runArtifactTask(deps, run, playbook, phase, phaseId, type, attempt);
    run = task.run;

    if (type === "compliance_report") assertCompliance(run.artifacts[type]);
    if (type === "quality_report") {
      const report = QualityReport.parse(run.artifacts[type]);
      const failedGates = report.results.filter((result) => !result.passed && !result.overridden).map((result) => result.gate);
      run = await emitTracked(
        deps,
        run,
        { type: "quality.evaluated", passed: report.clearedForLaunch, failedGates },
        "system",
      );
      assertQuality(report);
    }
  }

  return emitTracked(
    deps,
    run,
    { type: "phase.succeeded", phaseId: phaseId as never },
    "system",
  );
}

export async function runPhase(
  deps: OrchestratorDeps,
  initial: RunContextState,
  playbook: Playbook,
  phase: PhaseDef,
): Promise<RunContextState> {
  let run = initial;

  for (let attempt = 1; attempt <= MAX_PHASE_ATTEMPTS; attempt++) {
    try {
      return await executePhaseAttempt(deps, run, playbook, phase, attempt);
    } catch (error) {
      const phaseId = stableRuntimeId(run.state.runId, "phase", phase.key);
      run = await emitTracked(
        deps,
        run,
        { type: "phase.failed", phaseId: phaseId as never, error: errorRecord(error) },
        "system",
      );

      const disposition = dispositionOf(error);
      const mayRetry = phase.onFailure === "retry" && disposition === "retry" && attempt < MAX_PHASE_ATTEMPTS;
      if (mayRetry) {
        run = await emitTracked(
          deps,
          run,
          { type: "notice", level: "warn", message: `${phase.title} failed; retrying once with a fresh task attempt.` },
          "system",
        );
        continue;
      }

      logger.warn("phase stopped without producing all required artifacts", {
        phase: phase.key,
        configuredPolicy: phase.onFailure,
        disposition,
        error: String(error),
      });
      if (phase.onFailure !== "abort" && disposition !== "abort") {
        await escalatePhaseFailure(deps, phase, error);
      }
      throw error;
    }
  }

  throw new InvariantViolated(`phase ${phase.key} exhausted its attempt loop without returning or throwing`);
}

function supervisedGate(phase: PhaseDef): GateDef {
  return {
    key: `supervised-${phase.key}`,
    afterPhase: phase.key,
    title: `Approve ${phase.title}`,
    question: `Approve the completed ${phase.title.toLowerCase()} phase?`,
    rationale: "This run is supervised, so every phase boundary requires approval.",
  };
}

async function applyHardGate(
  deps: OrchestratorDeps,
  initial: RunContextState,
  playbook: Playbook,
  phase: PhaseDef,
): Promise<RunContextState> {
  let run = await refreshAtBoundary(deps, initial);
  const declared = playbook.hardGates.find((gate) => gate.afterPhase === phase.key);
  const gate = declared ?? (run.state.autonomy === "supervised" ? supervisedGate(phase) : undefined);
  if (!gate) return run;

  if (run.state.autonomy === "autonomous") {
    await deps.requestCheckpoint({
      kind: "hard_gate",
      title: `${gate.title} — 30-minute veto window`,
      question: `KILN plans to proceed with ${gate.title.toLowerCase()}. Veto within 30 minutes to stop it.`,
      context: gate.rationale,
      vetoWindowMs: 30 * 60 * 1_000,
      options: [
        {
          id: "proceed-after-window",
          label: "Proceed after window",
          description: "Continue automatically when the veto period ends.",
          consequence: "The next phase starts after 30 minutes if no veto is recorded.",
          recommended: true,
        },
        {
          id: "veto",
          label: "Veto",
          description: "Stop before the next phase.",
          consequence: "The run pauses for operator review.",
          recommended: false,
        },
      ],
    });
    return run;
  }

  const decision = await deps.requestCheckpoint({
    kind: "hard_gate",
    title: gate.title,
    question: gate.question,
    context: gate.rationale,
    options: [
      {
        id: "approve",
        label: "Approve",
        description: "Continue the build.",
        consequence: "The next phase starts immediately.",
        recommended: true,
      },
      {
        id: "revise",
        label: "Ask for changes",
        description: "Send this phase back for another pass.",
        consequence: "No downstream phase starts until the revision succeeds.",
        recommended: false,
      },
    ],
  });
  if (decision.approved) return run;

  run = await runPhase(deps, run, playbook, phase);
  const revised = await deps.requestCheckpoint({
    kind: "hard_gate",
    title: `${gate.title} — revised`,
    question: gate.question,
    context: gate.rationale,
    options: [
      {
        id: "approve",
        label: "Approve revision",
        description: "Continue with the revised artifact set.",
        consequence: "The next phase starts immediately.",
        recommended: true,
      },
      {
        id: "stop",
        label: "Stop",
        description: "Keep the run blocked for manual intervention.",
        consequence: "No downstream phase starts.",
        recommended: false,
      },
    ],
  });
  if (!revised.approved) throw new InvariantViolated(`revised hard gate ${gate.key} was not approved`);
  return run;
}

function requireLaunchClearance(run: RunContextState): void {
  assertQuality(run.artifacts["quality_report"]);
}

export async function runPlaybook(
  deps: OrchestratorDeps,
  initial: RunContextState,
  playbook: Playbook,
): Promise<RunContextState> {
  let run = initial;
  if (run.state.status === "queued") {
    run = await emitTracked(
      deps,
      run,
      {
        type: "run.started",
        playbookId: playbook.id,
        playbookVersion: playbook.version,
        autonomy: run.state.autonomy,
        seed: run.state.seed || `${run.state.runId}:${playbook.id}`,
        budgetMicros: playbook.estimatedCostMicros,
      },
      "system",
    );
  }

  for (const phase of playbook.phases) {
    run = await refreshAtBoundary(deps, run);
    const previous = run.state.phases.find((candidate) => candidate.key === phase.key);
    if (previous?.status === "succeeded" || previous?.status === "skipped") {
      run = await applyHardGate(deps, run, playbook, phase);
      continue;
    }
    run = await routeHumanDirectivesAtBoundary(deps, run, phase.key);
    if (phase.key === "launch") requireLaunchClearance(run);
    run = await runPhase(deps, run, playbook, phase);
    run = await applyHardGate(deps, run, playbook, phase);
  }

  return emitTracked(deps, run, { type: "run.succeeded" }, "system");
}

export function dispositionFor(error: unknown): "retry" | "degrade" | "escalate" | "abort" {
  return dispositionOf(error);
}

/** The declared artifacts a complete playbook run must leave behind. */
export function declaredArtifacts(playbook: Playbook): ArtifactType[] {
  return [...new Set(playbook.phases.flatMap((phase) => phase.produces))];
}
