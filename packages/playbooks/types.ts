import type {
  AgentId,
  Archetype,
  ArtifactType,
  QualityGateId,
  RunState,
  Scope,
  VentureBrief,
} from "@kiln/contracts";

/**
 * A Playbook is a versioned, declarative description of how to build one kind
 * of business — CLAUDE.md §11.
 *
 * The test of this abstraction: adding a vertical must require ZERO changes to
 * the runtime. If a new playbook needs a runtime change, the thing it needed
 * belongs in this interface instead.
 */

export interface PhaseDef {
  readonly key: string;
  readonly title: string;
  readonly agent: AgentId;
  readonly dependsOn: readonly ArtifactType[];
  readonly produces: readonly ArtifactType[];
  /** Returns true when this phase can be skipped for this run. */
  readonly optional?: (state: RunState, brief: VentureBrief) => boolean;
  readonly parallelWith?: readonly string[];
  readonly onFailure: "retry" | "degrade" | "escalate" | "abort";
}

export interface GateDef {
  readonly key: string;
  /** Phase boundary after which the gate fires. */
  readonly afterPhase: string;
  readonly title: string;
  readonly question: string;
  /** Why this is the customer's decision and not KILN's. */
  readonly rationale: string;
}

export interface Playbook {
  readonly id: string;
  readonly version: string;
  readonly archetype: Archetype;
  readonly title: string;
  readonly description: string;
  /** 0–1 confidence that this playbook fits the brief. */
  readonly applicability: (brief: VentureBrief) => number;
  readonly phases: readonly PhaseDef[];
  readonly hardGates: readonly GateDef[];
  readonly requiredScopes: readonly Scope[];
  readonly requiredConnections: readonly string[];
  readonly qualityGates: readonly QualityGateId[];
  readonly handoverManifest: readonly string[];
  readonly estimatedCostMicros: number;
  readonly estimatedDurationMinutes: number;
}

/** Reads a brief slot's value, or undefined when unanswered or deferred. */
export function slotValue<T>(brief: VentureBrief, key: keyof VentureBrief["slots"]): T | undefined {
  const slot = brief.slots[key];
  return slot.status === "answered" ? (slot.value as T) : undefined;
}

/** Case-insensitive keyword scan over the brief's free text. */
export function briefText(brief: VentureBrief): string {
  const parts = [brief.oneLiner];
  for (const slot of Object.values(brief.slots)) {
    if (slot.status === "answered") parts.push(JSON.stringify(slot.value));
  }
  return parts.join(" ").toLowerCase();
}
