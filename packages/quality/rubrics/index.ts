import type { ArtifactType, RubricAxis } from "@kiln/contracts";
import { AXIS_DEFINITIONS, PASS_THRESHOLD } from "@kiln/contracts";

/**
 * Critic rubrics — CLAUDE.md §3.2.
 *
 * A rubric names which axes apply to an artifact type and what a 5 looks like
 * for that specific artifact. The per-axis `lookFor` and `failWhen` strings go
 * into the Critic's prompt verbatim: a rubric that says only "score specificity
 * 0–5" produces a model scoring its own vibes, whereas "a 2 means the copy
 * would be true of any competitor" produces a judgement you can argue with.
 */

export interface AxisGuidance {
  readonly axis: RubricAxis;
  readonly lookFor: string;
  readonly failWhen: string;
}

export interface Rubric {
  readonly id: string;
  readonly artifactType: ArtifactType;
  readonly title: string;
  readonly axes: readonly AxisGuidance[];
  /** Extra checks phrased as questions the Critic must answer explicitly. */
  readonly interrogatives: readonly string[];
}

const axis = (a: RubricAxis, lookFor: string, failWhen: string): AxisGuidance => ({
  axis: a,
  lookFor,
  failWhen,
});

export const RUBRICS: Readonly<Record<string, Rubric>> = {
  "validation-report": {
    id: "validation-report",
    artifactType: "validation_report",
    title: "Validation report",
    axes: [
      axis(
        "specificity",
        "Named competitors with URLs, real search volumes, actual price points observed in the market.",
        "Market described in categories rather than named companies and numbers.",
      ),
      axis(
        "evidence",
        "Every volume, price, and market-size figure carries a document or tool source.",
        "Any quantitative claim resting on an assumption without a stated confidence.",
      ),
      axis(
        "commercialSharpness",
        "The verdict is decisive, and the unit economics show what has to be true for it to work.",
        "Hedged verdict, or economics that avoid stating contribution margin.",
      ),
      axis(
        "differentiation",
        "Identifies a specific gap the incumbents leave open, sourced from real customer complaints.",
        "Differentiation asserted as 'better quality' or 'better service'.",
      ),
    ],
    interrogatives: [
      "If the verdict is `go`, what single piece of evidence most supports it, and how strong is that evidence really?",
      "Would a sceptical founder who knows this market find anything here they did not already know?",
      "Is the contribution margin positive at the stated price? If not, is that stated plainly?",
    ],
  },

  "strategy-memo": {
    id: "strategy-memo",
    artifactType: "strategy_memo",
    title: "Strategy memo",
    axes: [
      axis(
        "specificity",
        "The ICP is a person in a situation with a trigger event, not a demographic bracket.",
        "ICP could describe a quarter of the population.",
      ),
      axis(
        "differentiation",
        "The positioning statement commits to something a competitor could not paste onto their own site.",
        "Statement survives find-and-replace of the brand name.",
      ),
      axis(
        "commercialSharpness",
        "Price ladder has a rationale per tier and names which tier the business is built to sell.",
        "Tiers exist but the reasoning is 'good, better, best'.",
      ),
      axis(
        "evidence",
        "Objections and buying criteria trace back to observed customer language.",
        "Objections invented rather than mined.",
      ),
    ],
    interrogatives: [
      "What is this business deliberately bad at? If the answer is nothing, the positioning is not real.",
      "Name the competitor most threatened by this positioning. If none, it is not differentiated.",
    ],
  },

  "brand-system": {
    id: "brand-system",
    artifactType: "brand_system",
    title: "Brand system",
    axes: [
      axis(
        "visualCraft",
        "Type pairing, palette, spacing, and edge personality read as one deliberate hand.",
        "Defaults: 16px base, symmetric colour ramp, 8px everything, medium radius on all corners.",
      ),
      axis(
        "differentiation",
        "The system would be recognisable next to three competitors in the same category.",
        "Could be swapped with any other brand in the category without anyone noticing.",
      ),
      axis(
        "voiceFidelity",
        "The voice charter's neverWrites list contains things the brand would plausibly be tempted to write.",
        "neverWrites lists things nobody would write anyway, so it constrains nothing.",
      ),
      axis(
        "specificity",
        "Visual direction names lighting, composition, and materials precisely enough to constrain a generator.",
        "Direction reads as adjectives: clean, modern, premium.",
      ),
    ],
    interrogatives: [
      "Is there a purple-to-blue gradient, a glassmorphism panel, or a centred hero with a floating mockup? Any of these is an automatic fail on visualCraft.",
      "Does the palette contrast check actually pass for the text-on-background pair used most often?",
    ],
  },

  "product-catalogue": {
    id: "product-catalogue",
    artifactType: "product_catalogue",
    title: "Product catalogue",
    axes: [
      axis(
        "specificity",
        "Descriptions name materials, dimensions, origin, and what the buyer gets in the box.",
        "Descriptions that could be attached to a different product without editing.",
      ),
      axis(
        "commercialSharpness",
        "Pricing reflects the unit economics; bundles have a stated reason to exist.",
        "Prices ending in 9 with no rationale, or bundles that just group leftovers.",
      ),
      axis(
        "voiceFidelity",
        "Copy sounds like the voice charter, including its lexicon.",
        "Generic ecommerce register regardless of brand.",
      ),
      axis(
        "evidence",
        "Price points and specifications trace to supplier quotes or competitor observation.",
        "Invented specifications.",
      ),
    ],
    interrogatives: [
      "Does every product have a description of 120+ words that passes the slop linter?",
      "Could a buyer tell two products in this catalogue apart from the copy alone?",
    ],
  },

  "supply-plan": {
    id: "supply-plan",
    artifactType: "supply_plan",
    title: "Supply plan",
    axes: [
      axis("specificity", "Named suppliers, real MOQs, actual lead times in days.", "Supplier 'types' rather than names."),
      axis("evidence", "Landed costs decompose into unit, freight, duty, and handling with sources.", "A single blended cost figure."),
      axis(
        "commercialSharpness",
        "The MOQ-versus-POD trade-off states capital at risk and time to first sale for each option.",
        "A recommendation without the rejected option's numbers.",
      ),
    ],
    interrogatives: [
      "How much of the customer's money is at risk before the first sale, under the recommended option?",
      "Is the returns policy consistent with the fulfilment model, or does it promise something POD cannot deliver?",
    ],
  },

  "content-set": {
    id: "content-set",
    artifactType: "content_set",
    title: "Content set",
    axes: [
      axis("voiceFidelity", "Reads as the brand, consistently, across pages and emails.", "Reads as competent generic marketing."),
      axis("specificity", "Concrete nouns, real numbers, named situations.", "Abstractions and benefit-speak."),
      axis("commercialSharpness", "Each page moves the reader toward one decision and answers one objection.", "Pages that inform without asking for anything."),
      axis("differentiation", "Says something a competitor's site does not.", "Interchangeable category copy."),
    ],
    interrogatives: [
      "Pick the weakest sentence in the set and quote it. Why is it weak?",
      "Does any page open with a rhetorical question or a definition of the category?",
    ],
  },

  "growth-plan": {
    id: "growth-plan",
    artifactType: "growth_plan",
    title: "Growth plan",
    axes: [
      axis("specificity", "First action per channel is something a person could do tomorrow morning.", "'Post consistently', 'engage the community'."),
      axis("evidence", "Keyword volumes and CAC estimates are sourced.", "Invented search volumes."),
      axis("commercialSharpness", "Channels have review dates and abandon criteria.", "A channel list with no decision rule."),
    ],
    interrogatives: [
      "Which channel gets cut first if the budget halves, and does the plan say so?",
      "Are the local landing pages built on genuinely different search intent, or are they spun duplicates?",
    ],
  },

  "operating-digest": {
    id: "operating-digest",
    artifactType: "operating_digest",
    title: "Operating digest",
    axes: [
      axis("specificity", "Names the product, the number, and the change.", "'Traffic is down slightly.'"),
      axis("evidence", "Every statement in the narrative maps to a reading in the payload.", "Interpretation with no number behind it."),
      axis("commercialSharpness", "Proposes one action with an expected effect, not a list of observations.", "Ends without proposing anything."),
    ],
    interrogatives: [
      "Is the narrative exactly three sentences?",
      "If the data is stale, does the digest say so rather than presenting old numbers as current?",
    ],
  },
};

export const RUBRIC_BY_ARTIFACT: Readonly<Partial<Record<ArtifactType, Rubric>>> = Object.fromEntries(
  Object.values(RUBRICS).map((r) => [r.artifactType, r]),
);

export function rubricFor(type: ArtifactType): Rubric | undefined {
  return RUBRIC_BY_ARTIFACT[type];
}

export { PASS_THRESHOLD, AXIS_DEFINITIONS };
