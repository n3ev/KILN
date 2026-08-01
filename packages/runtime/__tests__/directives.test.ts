import { randomUUID } from "node:crypto";
import { RunEvent, RunState, type RunEvent as RunEventValue } from "@kiln/contracts";
import { describe, expect, it } from "vitest";
import {
  directiveAppliesAtBoundary,
  memoWithAppliedHumanDirectives,
  renderMemo,
  routeHumanDirectivesAtBoundary,
  type OrchestratorDeps,
  type RunContextState,
} from "../index.js";

const directiveId = randomUUID();
const userId = randomUUID();

function runState() {
  return RunState.parse({
    runId: randomUUID(),
    ventureId: randomUUID(),
    playbookId: "digital-product",
    playbookVersion: "1.0.0",
    status: "running",
    autonomy: "guided",
    seed: "directive-test",
    humanDirectives: [{
      directiveId,
      directive: "Remove the third product before building the storefront.",
      byUserId: userId,
      applyAt: "next_phase",
      receivedPhaseKey: "offer",
      submittedAt: "2026-08-01T10:00:00.000Z",
      status: "queued",
    }],
  });
}

describe("human directive routing", () => {
  it("waits until the next phase and emits the Planner application once", async () => {
    const emitted: RunEventValue[] = [];
    const state = runState();
    const initial = {
      state,
      brief: {} as RunContextState["brief"],
      memo: { entries: [], approxTokens: 0 },
      artifacts: {},
      archetype: "digital" as const,
    };
    const deps = {
      emit: async (event: RunEventValue) => {
        emitted.push(RunEvent.parse(event));
        return emitted.length;
      },
      now: () => "2026-08-01T10:05:00.000Z",
    } as unknown as OrchestratorDeps;

    expect(directiveAppliesAtBoundary(state.humanDirectives[0]!, "offer")).toBe(false);
    const unchanged = await routeHumanDirectivesAtBoundary(deps, initial, "offer");
    expect(unchanged.state.humanDirectives[0]?.status).toBe("queued");
    expect(emitted).toEqual([]);

    const applied = await routeHumanDirectivesAtBoundary(deps, unchanged, "infrastructure");
    expect(emitted).toEqual([{
      type: "human_directive.applied",
      directiveId,
      phaseKey: "infrastructure",
      appliedByAgentId: "planner",
    }]);
    expect(applied.state.humanDirectives[0]).toMatchObject({
      status: "applied",
      appliedPhaseKey: "infrastructure",
    });
    await routeHumanDirectivesAtBoundary(deps, applied, "build");
    expect(emitted).toHaveLength(1);
  });

  it("reconstructs only applied directives into model context", () => {
    const queued = runState().humanDirectives[0]!;
    const applied = {
      ...queued,
      status: "applied" as const,
      appliedPhaseKey: "infrastructure",
      appliedAt: "2026-08-01T10:05:00.000Z",
    };
    expect(renderMemo(memoWithAppliedHumanDirectives({ entries: [], approxTokens: 0 }, [queued]))).toBe("");
    expect(renderMemo(memoWithAppliedHumanDirectives({ entries: [], approxTokens: 0 }, [applied])))
      .toContain("Remove the third product before building the storefront.");
  });
});
