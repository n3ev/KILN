import type { VentureBrief } from "@kiln/contracts";
import { digitalProduct } from "./digital-product/index.js";
import { localService } from "./local-service/index.js";
import { physicalShopify } from "./physical-shopify/index.js";
import type { Playbook } from "./types.js";

/**
 * The archetype router.
 *
 * Scores every playbook against the brief and picks the best. A tie or a
 * low-confidence winner produces a checkpoint asking the customer rather than a
 * coin flip: picking the wrong archetype means building a storefront for a
 * business that needed a booking calendar, and that is discovered late.
 */

export const PLAYBOOKS: readonly Playbook[] = [physicalShopify, digitalProduct, localService];

/** Below this, ask the customer instead of guessing. */
export const CONFIDENCE_FLOOR = 0.55;
/** Two playbooks within this of each other are a tie. */
export const TIE_MARGIN = 0.12;

export interface RouteResult {
  readonly playbook: Playbook;
  readonly confidence: number;
  readonly scores: readonly { playbookId: string; score: number }[];
  /** True when the customer must confirm before the run proceeds. */
  readonly needsConfirmation: boolean;
  readonly reason: string;
}

export function route(brief: VentureBrief): RouteResult {
  const scores = PLAYBOOKS.map((p) => ({ playbookId: p.id, score: p.applicability(brief), playbook: p })).sort(
    (a, b) => b.score - a.score,
  );

  const best = scores[0];
  const runnerUp = scores[1];
  if (!best) throw new Error("no playbooks registered");

  const tie = runnerUp !== undefined && best.score - runnerUp.score < TIE_MARGIN;
  const lowConfidence = best.score < CONFIDENCE_FLOOR;

  return {
    playbook: best.playbook,
    confidence: best.score,
    scores: scores.map(({ playbookId, score }) => ({ playbookId, score })),
    needsConfirmation: tie || lowConfidence,
    reason: lowConfidence
      ? `Best match scored ${best.score.toFixed(2)}, below the ${CONFIDENCE_FLOOR} floor. The brief does not clearly describe one kind of business.`
      : tie
        ? `"${best.playbookId}" and "${runnerUp?.playbookId}" scored within ${TIE_MARGIN} of each other.`
        : `"${best.playbookId}" scored ${best.score.toFixed(2)}, clearly ahead of the alternatives.`,
  };
}

export function playbookById(id: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.id === id);
}

export function requirePlaybook(id: string): Playbook {
  const playbook = playbookById(id);
  if (!playbook) throw new Error(`Unknown playbook "${id}". Known: ${PLAYBOOKS.map((p) => p.id).join(", ")}`);
  return playbook;
}
