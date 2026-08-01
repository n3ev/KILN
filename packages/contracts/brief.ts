import { z } from "zod";
import {
  Archetype,
  Confidence,
  CountryCode,
  Currency,
  LocaleCode,
  Micros,
  Timestamp,
} from "./primitives.js";
import { SourceRef } from "./sources.js";

/**
 * The VentureBrief — output of the Interviewer.
 *
 * Twelve slots. Every one of them changes what gets built, and a wrong answer
 * downstream is expensive, so the Interviewer may not proceed while any slot is
 * `unanswered`. It may proceed on `deferred`, which is a recorded decision with
 * a reason, not silence. This distinction is the whole point: an unanswered
 * question is a hole in the plan, a deferred one is a known unknown that the
 * Analyst is told to price.
 */

export const SlotKey = z.enum([
  "problem", // the job the customer is hiring this to do
  "customer", // who specifically, not "everyone who likes X"
  "offer", // the thing actually sold, in one sentence
  "price", // intended price point and why that number
  "differentiation", // why this and not the incumbent
  "channel", // how the first 100 customers find it
  "economics", // COGS, margin expectation, delivery cost
  "capital", // money available to put in before revenue
  "commitment", // hours per week the founder will give it
  "geography", // where they sell and from where
  "fulfilment", // how the thing reaches the buyer
  "redlines", // what they will not do under any circumstances
]);
export type SlotKey = z.infer<typeof SlotKey>;

/** Human-readable prompts. The Interviewer paraphrases; it never invents slots. */
export const SLOT_QUESTIONS: Readonly<Record<SlotKey, string>> = {
  problem: "What is the buyer trying to get done, in their words, not yours?",
  customer: "Who exactly buys this? Name a person you could actually find.",
  offer: "What is sold, in one sentence a stranger would understand?",
  price: "What does it cost the buyer, and why that number?",
  differentiation: "Why would someone pick this over what they use now?",
  channel: "Where do the first hundred buyers come from?",
  economics: "What does one unit cost you to make and deliver?",
  capital: "How much can you put in before the first sale?",
  commitment: "How many hours a week will you actually give this?",
  geography: "Where do you sell, and where do you ship or work from?",
  fulfilment: "How does the thing get to the buyer?",
  redlines: "What will you not do, no matter how well it would work?",
};

const answered = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    status: z.literal("answered"),
    value,
    /** Usually a `customer` source; occasionally inferred with confidence. */
    sources: z.array(SourceRef).min(1),
    confidence: Confidence.default(1),
  });

const deferred = z.object({
  status: z.literal("deferred"),
  /** Why it is safe to proceed without this. Shown at the first hard gate. */
  reason: z.string().min(1),
  /** The phase by which it must be resolved, or the run stalls there. */
  revisitBy: z.string().min(1),
});

const unanswered = z.object({ status: z.literal("unanswered") });

/** A brief slot: answered with evidence, consciously deferred, or still open. */
export const slot = <T extends z.ZodTypeAny>(value: T) =>
  z.discriminatedUnion("status", [answered(value), deferred, unanswered]);

export const PriceIntent = z.object({
  amountMicros: Micros,
  currency: Currency,
  model: z.enum(["one-off", "subscription", "hourly", "per-project", "tiered"]),
  rationale: z.string().min(1),
});

export const EconomicsIntent = z.object({
  unitCostMicros: Micros.optional(),
  deliveryCostMicros: Micros.optional(),
  targetGrossMarginPct: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

export const GeographyIntent = z.object({
  sellsTo: z.array(CountryCode).min(1),
  operatesFrom: CountryCode,
  /** Set for local-service ventures; drives service-area page generation. */
  serviceRadiusKm: z.number().positive().optional(),
  locality: z.string().optional(),
  locales: z.array(LocaleCode).default(["en"]),
});

export const FulfilmentIntent = z.object({
  model: z.enum(["print-on-demand", "wholesale-stock", "made-to-order", "digital-download", "in-person", "hybrid"]),
  leadTimeDays: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

export const VentureBrief = z.object({
  /** The sentence the customer arrived with, preserved verbatim, always. */
  oneLiner: z.string().min(8).max(500),
  workingName: z.string().optional(),

  slots: z.object({
    problem: slot(z.string().min(1)),
    customer: slot(z.string().min(1)),
    offer: slot(z.string().min(1)),
    price: slot(PriceIntent),
    differentiation: slot(z.string().min(1)),
    channel: slot(z.array(z.string().min(1)).min(1)),
    economics: slot(EconomicsIntent),
    capital: slot(z.object({ amountMicros: Micros, currency: Currency })),
    commitment: slot(z.object({ hoursPerWeek: z.number().min(0).max(168) })),
    geography: slot(GeographyIntent),
    fulfilment: slot(FulfilmentIntent),
    redlines: slot(z.array(z.string().min(1))),
  }),

  /** The Interviewer's read on which playbook fits. The router may disagree. */
  archetypeHint: z.object({
    archetype: Archetype,
    confidence: Confidence,
    reasoning: z.string().min(1),
  }),

  /**
   * Contradictions the Interviewer found and could not resolve. A brief may
   * ship with these; the Analyst is required to address each one.
   */
  tensions: z
    .array(
      z.object({
        between: z.tuple([SlotKey, SlotKey]),
        description: z.string().min(1),
        severity: z.enum(["note", "material", "blocking"]),
      }),
    )
    .default([]),

  /** Disclosure record — CLAUDE.md §12.2.4. Set before any provisioning. */
  ownershipDisclosureAcceptedAt: Timestamp.optional(),

  createdAt: Timestamp,
});
export type VentureBrief = z.infer<typeof VentureBrief>;

export type BriefSlots = VentureBrief["slots"];

/** Slots still `unanswered`. Non-empty means the Interviewer is not done. */
export function openSlots(brief: VentureBrief): SlotKey[] {
  return SlotKey.options.filter((k) => brief.slots[k].status === "unanswered");
}

export function deferredSlots(brief: VentureBrief): SlotKey[] {
  return SlotKey.options.filter((k) => brief.slots[k].status === "deferred");
}

/** A brief is complete when nothing is silently missing. Deferral is allowed. */
export function isBriefComplete(brief: VentureBrief): boolean {
  return openSlots(brief).length === 0;
}

export function hasBlockingTension(brief: VentureBrief): boolean {
  return brief.tensions.some((t) => t.severity === "blocking");
}
