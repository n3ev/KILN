import type { HumanDirectiveState, RunMemo } from "@kiln/contracts";
import { appendMemo } from "./context.js";
import type { OrchestratorDeps, RunContextState } from "./runtime-types.js";
import { emitTracked } from "./tracking.js";

/** A next-phase directive cannot cross into the phase that was active when it arrived. */
export function directiveAppliesAtBoundary(
  directive: HumanDirectiveState,
  phaseKey: string,
): boolean {
  if (directive.status !== "queued") return false;
  if (directive.applyAt === "current_phase") return true;
  return directive.receivedPhaseKey === undefined || directive.receivedPhaseKey !== phaseKey;
}

/**
 * The Planner is a structural runtime role here: it moves queued customer
 * intent into the operative context only between phases, never halfway through
 * an agent invocation or tool side effect.
 */
export async function routeHumanDirectivesAtBoundary(
  deps: OrchestratorDeps,
  initial: RunContextState,
  phaseKey: string,
): Promise<RunContextState> {
  let run = initial;
  const queued = run.state.humanDirectives.filter((directive) =>
    directiveAppliesAtBoundary(directive, phaseKey),
  );
  for (const directive of queued) {
    run = await emitTracked(
      deps,
      run,
      {
        type: "human_directive.applied",
        directiveId: directive.directiveId,
        phaseKey,
        appliedByAgentId: "planner",
      },
      "agent",
    );
  }
  return run;
}

/** Rebuilds directive context from the event-derived state after any restart. */
export function memoWithAppliedHumanDirectives(
  memo: RunMemo,
  directives: readonly HumanDirectiveState[],
): RunMemo {
  return directives
    .filter((directive) => directive.status === "applied")
    .reduce(
      (current, directive) => appendMemo(current, {
        phase: directive.appliedPhaseKey ?? "planner",
        decision: `Customer directive: ${directive.directive}`,
        rationale: `Planner routed human directive ${directive.directiveId} at a safe phase boundary.`,
        at: directive.appliedAt ?? directive.submittedAt,
      }),
      memo,
    );
}
