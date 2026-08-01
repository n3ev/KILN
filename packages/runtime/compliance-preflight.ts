import { CategoryScreenResult, ComplianceBlocked } from "@kiln/contracts";
import type { PhaseDef } from "@kiln/playbooks";
import { stableRuntimeId, emitTracked } from "./tracking.js";
import type { OrchestratorDeps, RunContextState } from "./runtime-types.js";

function jurisdictions(run: RunContextState): string[] {
  const slot = run.brief.slots.geography;
  if (slot.status !== "answered") return ["AU"];
  return [...new Set([slot.value.operatesFrom, ...slot.value.sellsTo])];
}

function productTypes(run: RunContextState): string[] {
  const offer = run.brief.slots.offer;
  return offer.status === "answered" ? [offer.value] : [run.brief.oneLiner];
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

/** Runs once before the first build task and fails closed on prohibited ideas. */
export async function runCompliancePreflight(
  deps: OrchestratorDeps,
  initial: RunContextState,
  phase: PhaseDef,
  phaseId: string,
): Promise<RunContextState> {
  const taskId = stableRuntimeId(initial.state.runId, "task", "compliance-preflight");
  if (initial.state.tasks.some((task) => task.id === taskId && task.status === "succeeded")) return initial;

  let run = await emitTracked(
    deps,
    initial,
    {
      type: "task.started",
      taskId: taskId as never,
      phaseId: phaseId as never,
      agentId: "compliance-officer",
      title: "Restricted-category preflight",
      attempt: 1,
    },
    "system",
  );
  const toolCallId = stableRuntimeId(run.state.runId, "tool", taskId, "category.screen");
  const input = {
    description: JSON.stringify(run.brief),
    productTypes: productTypes(run),
    jurisdictions: jurisdictions(run),
  };
  run = await emitTracked(
    deps,
    run,
    { type: "tool.called", taskId: taskId as never, toolCallId, toolId: "category.screen", sandboxed: deps.toolContext("compliance-officer", taskId).sandbox, input },
    "system",
  );

  try {
    const startedAt = performance.now();
    const result = CategoryScreenResult.parse(
      await deps.callTool("category.screen", input, deps.toolContext("compliance-officer", taskId)),
    );
    run = await emitTracked(
      deps,
      run,
      { type: "tool.succeeded", toolCallId, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)), costMicros: 0 },
      "tool",
    );
    const flagged = result.findings.filter((finding) => finding.severity !== "permitted");
    if (flagged.length > 0) await deps.flagComplianceReview?.(flagged);
    if (result.status === "blocked") {
      throw new ComplianceBlocked(
        result.findings
          .filter((finding) => finding.severity === "prohibited")
          .map((finding) => finding.detail),
        { phase: phase.key },
      );
    }
    return emitTracked(
      deps,
      run,
      { type: "task.succeeded", taskId: taskId as never },
      "system",
    );
  } catch (error) {
    if (!(error instanceof ComplianceBlocked)) {
      run = await emitTracked(deps, run, { type: "tool.failed", toolCallId, error: errorRecord(error) }, "tool");
    }
    await emitTracked(deps, run, { type: "task.failed", taskId: taskId as never, error: errorRecord(error) }, "system");
    throw error;
  }
}
