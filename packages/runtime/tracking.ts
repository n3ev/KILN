import { createHash } from "node:crypto";
import type { RunEvent } from "@kiln/contracts";
import { apply } from "./events.js";
import type { OrchestratorDeps, RunContextState } from "./runtime-types.js";

export function runtimeNow(deps: OrchestratorDeps): string {
  return deps.now?.() ?? new Date().toISOString();
}

/** A stable UUID-shaped id for replay-safe phase, task, and candidate ids. */
export function stableRuntimeId(runId: string, ...parts: readonly string[]): string {
  const hex = createHash("sha256").update([runId, ...parts].join("\0")).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

/** Persist first, then mirror that exact transition into the in-memory fold. */
export async function emitTracked(
  deps: OrchestratorDeps,
  run: RunContextState,
  event: RunEvent,
  actor: "agent" | "tool" | "human" | "system",
): Promise<RunContextState> {
  const seq = await deps.emit(event, actor);
  return {
    ...run,
    state: { ...apply(run.state, event, runtimeNow(deps)), lastSeq: seq },
  };
}

export async function refreshAtBoundary(
  deps: OrchestratorDeps,
  run: RunContextState,
): Promise<RunContextState> {
  if (!deps.refreshState) return run;
  return { ...run, state: await deps.refreshState() };
}
