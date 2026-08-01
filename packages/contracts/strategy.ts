import { z } from "zod";
import { Currency, Micros, Timestamp } from "./primitives.js";
import { SourceRef, sourced } from "./sources.js";

/** Strategist output. Positioning that commits to something, or it is worthless. */

export const IdealCustomerProfile = z.object({
  /** A person, not a demographic bucket. "Marta, 34, ceramicist in Lisbon." */
  portrait: z.string().min(1),
  situation: z.string().min(1),
  /** The moment they start looking. Positioning hangs off this. */
  triggerEvent: z.string().min(1),
  currentSolution: z.string().min(1),
  frustrations: z.array(z.string().min(1)).min(2),
  buyingCriteria: z.array(z.string().min(1)).min(2),
  whereTheyAre: z.array(z.string().min(1)).min(1),
  disqualifiers: z.array(z.string().min(1)).default([]),
  evidence: z.array(SourceRef).min(1),
});

export const OfferTier = z.object({
  name: z.string().min(1),
  priceMicros: Micros,
  currency: Currency,
  /** What the buyer gets. Concrete deliverables, never adjectives. */
  includes: z.array(z.string().min(1)).min(1),
  excludes: z.array(z.string().min(1)).default([]),
  forWhom: z.string().min(1),
  /** Why this price and not 20% less. The Critic checks this hard. */
  priceRationale: z.string().min(1),
  anchorRole: z.enum(["entry", "core", "premium", "decoy"]),
});

export const PriceLadder = z.object({
  currency: Currency,
  tiers: z.array(OfferTier).min(1),
  /** The tier the business is actually built to sell. */
  primaryTierName: z.string().min(1),
  strategy: z.enum(["penetration", "premium", "value", "competitive", "anchored"]),
  reasoning: z.string().min(1),
});

export const Objection = z.object({
  objection: z.string().min(1),
  /** Where it surfaces, so content can answer it in place. */
  surfacesAt: z.enum(["ad", "landing", "product", "cart", "checkout", "post-purchase"]),
  response: z.string().min(1),
  proofRequired: z.string().optional(),
});

export const DifferentiationThesis = z.object({
  /** One sentence. If it could be said by a competitor, it is not one. */
  statement: z.string().min(1).max(300),
  /** What KILN is deliberately worse at. A thesis without a cost is a slogan. */
  tradeoffAccepted: z.string().min(1),
  substantiation: z.array(SourceRef).min(1),
  defensibility: z.enum(["none", "weak", "moderate", "strong"]),
  defensibilityReasoning: z.string().min(1),
});

export const StrategyMemo = z.object({
  positioningStatement: z.string().min(1).max(500),
  icp: IdealCustomerProfile,
  secondaryIcps: z.array(IdealCustomerProfile).max(2).default([]),
  differentiation: DifferentiationThesis,
  priceLadder: PriceLadder,
  objections: z.array(Objection).min(3),

  /** Category the business competes in, and the one it would rather create. */
  category: z.object({
    competesIn: z.string().min(1),
    aspiresTo: z.string().optional(),
  }),

  ninetyDayThesis: z.object({
    /** The single bet. Not a list of five priorities. */
    primaryBet: z.string().min(1),
    successLooksLike: sourced(z.string().min(1)),
    /** Kill criteria for the bet itself, agreed up front. */
    abandonIf: z.string().min(1),
    milestones: z
      .array(
        z.object({
          week: z.number().int().min(1).max(13),
          milestone: z.string().min(1),
          measurable: z.string().min(1),
        }),
      )
      .min(3),
  }),

  generatedAt: Timestamp,
});
export type StrategyMemo = z.infer<typeof StrategyMemo>;
export type IdealCustomerProfile = z.infer<typeof IdealCustomerProfile>;
export type PriceLadder = z.infer<typeof PriceLadder>;
export type OfferTier = z.infer<typeof OfferTier>;
