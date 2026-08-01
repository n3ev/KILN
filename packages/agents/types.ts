import type { AgentId, ArtifactType, VentureBrief } from "@kiln/contracts";
import type { ModelSelector } from "@kiln/model-gateway";
import type { z } from "zod";

/**
 * Agent definitions are pure declarations — CLAUDE.md §8.3.
 *
 * The runtime owns the loop: build messages, call the gateway, validate tool
 * calls against the allowlist, execute through the tool layer, append results,
 * repeat to `maxSteps`, validate the output schema, hand to the Critic if a
 * rubric is set, write the artifact.
 *
 * Nothing here executes anything. An agent that could call a tool directly
 * would bypass permissions, budget, and audit in one line.
 */

export interface AgentContext {
  readonly brief: VentureBrief;
  /** The rolling run memo — decisions and rationale, capped at ~2k tokens. */
  readonly memo: string;
  /** Named upstream artifacts this agent declared as dependencies. */
  readonly upstream: Readonly<Partial<Record<ArtifactType, unknown>>>;
  /** Brand voice, once it exists. Any agent producing prose receives it. */
  readonly voice?: { attributes: string[]; writes: string[]; neverWrites: string[]; emojiAllowed: boolean };
  readonly archetype: "physical" | "digital" | "service";
  readonly runId: string;
  readonly seed: string;
  /** Set when this invocation is repairing a rejected artifact. */
  readonly critique?: string;
  /** Set when the slop linter blocked a previous draft. */
  readonly lintFeedback?: string;
}

export interface AgentDef<I extends z.ZodTypeAny = z.ZodTypeAny, O extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly id: AgentId;
  readonly title: string;
  /** Semver. Bump on any prompt change — fixtures key off it. */
  readonly version: string;
  readonly model: ModelSelector;
  readonly systemPrompt: (ctx: AgentContext) => string;
  readonly input: I;
  readonly output: O;
  /** Exhaustive allowlist. The runtime rejects anything not listed. */
  readonly tools: readonly string[];
  readonly maxSteps: number;
  readonly maxCostMicros: number;
  readonly rubric?: string;
  readonly temperature: number;
  /** Artifact this agent writes on success. */
  readonly produces?: ArtifactType;
  /** Token budget for assembled context; truncation is logged. */
  readonly contextBudgetTokens: number;
}

/** Erased form, for registry storage. See tools/core/define.ts for the why. */
export type AnyAgent = Omit<AgentDef<z.ZodTypeAny, z.ZodTypeAny>, "input" | "output"> & {
  readonly input: z.ZodTypeAny;
  readonly output: z.ZodTypeAny;
};

export function defineAgent<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(def: AgentDef<I, O>): AgentDef<I, O> {
  if (def.tools.length === 0 && def.maxSteps > 1) {
    throw new Error(`Agent "${def.id}" has no tools but allows ${def.maxSteps} steps; set maxSteps to 1.`);
  }
  return def;
}
