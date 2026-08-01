import { z } from "zod";
import { defineTool, type AnyTool } from "../../core/define.js";
import { fakeId, seedFor, slugify, units } from "../_helpers.js";

/** Unit economics, pricing, and budget requests. */

export const pnlModel = defineTool({
  id: "pnl.model",
  version: "1.0.0",
  title: "Model unit economics",
  description:
    "Builds a unit-economics model from price and cost inputs and returns contribution margin, " +
    "breakeven volume, and a sensitivity table. Use LANDED cost, not the supplier's unit price \u2014 " +
    "freight, duty, and handling are what usually turn a viable margin negative. A negative " +
    "contribution margin is a valid and important result: report it rather than adjusting " +
    "inputs until it looks acceptable.",
  scopes: ["research:read"],
  sideEffect: "none",
  input: z.object({
    priceMicros: z.number().int().nonnegative(),
    landedCostMicros: z.number().int().nonnegative(),
    fulfilmentMicros: z.number().int().nonnegative().default(0),
    paymentFeePct: z.number().min(0).max(20).default(2.9),
    paymentFeeFixedMicros: z.number().int().nonnegative().default(units(0.3)),
    variableAdSpendMicros: z.number().int().nonnegative().default(0),
    fixedMonthlyMicros: z.number().int().nonnegative().default(0),
    currency: z.string().length(3).default("GBP"),
  }),
  output: z.object({
    currency: z.string(),
    contributionMarginMicros: z.number().int(),
    contributionMarginPct: z.number(),
    paymentFeesMicros: z.number().int(),
    breakevenUnitsPerMonth: z.number(),
    sensitivity: z.array(z.object({ variable: z.string(), deltaPct: z.number(), contributionMarginMicros: z.number().int() })),
  }),
  idempotent: true,
  timeoutMs: 10_000,
  execute: modelPnl,
  simulate: modelPnl,
});

async function modelPnl(input: {
  priceMicros: number; landedCostMicros: number; fulfilmentMicros: number; paymentFeePct: number;
  paymentFeeFixedMicros: number; variableAdSpendMicros: number; fixedMonthlyMicros: number; currency: string;
}) {
  const compute = (price: number, cost: number, ads: number): number => {
    const fees = Math.round(price * (input.paymentFeePct / 100)) + input.paymentFeeFixedMicros;
    return price - cost - input.fulfilmentMicros - fees - ads;
  };

  const paymentFeesMicros = Math.round(input.priceMicros * (input.paymentFeePct / 100)) + input.paymentFeeFixedMicros;
  const cm = compute(input.priceMicros, input.landedCostMicros, input.variableAdSpendMicros);

  return {
    currency: input.currency,
    contributionMarginMicros: cm,
    contributionMarginPct: input.priceMicros === 0 ? 0 : (cm / input.priceMicros) * 100,
    paymentFeesMicros,
    // Guard the divide: a non-positive margin never breaks even, and reporting
    // Infinity is more honest than reporting a small number.
    breakevenUnitsPerMonth: cm > 0 ? input.fixedMonthlyMicros / cm : Number.POSITIVE_INFINITY,
    sensitivity: [
      { variable: "price", deltaPct: -10, contributionMarginMicros: compute(Math.round(input.priceMicros * 0.9), input.landedCostMicros, input.variableAdSpendMicros) },
      { variable: "price", deltaPct: 10, contributionMarginMicros: compute(Math.round(input.priceMicros * 1.1), input.landedCostMicros, input.variableAdSpendMicros) },
      { variable: "landedCost", deltaPct: 20, contributionMarginMicros: compute(input.priceMicros, Math.round(input.landedCostMicros * 1.2), input.variableAdSpendMicros) },
      { variable: "adSpend", deltaPct: 50, contributionMarginMicros: compute(input.priceMicros, input.landedCostMicros, Math.round(input.variableAdSpendMicros * 1.5)) },
    ],
  };
}

export const breakevenCompute = defineTool({
  id: "breakeven.compute",
  version: "1.0.0",
  title: "Compute breakeven",
  description:
    "Returns the units per month needed to cover fixed costs at a given contribution margin, " +
    "and how long that takes at an assumed run rate. If contribution margin is zero or " +
    "negative the answer is 'never', and this tool says so rather than returning a large number " +
    "that reads like a target.",
  scopes: ["research:read"],
  sideEffect: "none",
  input: z.object({ contributionMarginMicros: z.number().int(), fixedMonthlyMicros: z.number().int().nonnegative(), assumedUnitsPerMonth: z.number().nonnegative().default(0) }),
  output: z.object({ reachable: z.boolean(), unitsPerMonth: z.number(), monthsAtAssumedRate: z.number().nullable(), note: z.string() }),
  idempotent: true,
  timeoutMs: 10_000,
  execute: computeBreakeven,
  simulate: computeBreakeven,
});

async function computeBreakeven(input: { contributionMarginMicros: number; fixedMonthlyMicros: number; assumedUnitsPerMonth: number }) {
  if (input.contributionMarginMicros <= 0) {
    return { reachable: false, unitsPerMonth: Number.POSITIVE_INFINITY, monthsAtAssumedRate: null, note: "Contribution margin is not positive, so volume never covers fixed costs. Price or cost has to change." };
  }
  const unitsPerMonth = input.fixedMonthlyMicros / input.contributionMarginMicros;
  return {
    reachable: true,
    unitsPerMonth,
    monthsAtAssumedRate: input.assumedUnitsPerMonth > 0 ? unitsPerMonth / input.assumedUnitsPerMonth : null,
    note: `Needs ${Math.ceil(unitsPerMonth)} units a month to cover fixed costs.`,
  };
}

export const pricingOptimise = defineTool({
  id: "pricing.optimise",
  version: "1.0.0",
  title: "Suggest a price point",
  description:
    "Suggests a price given cost, competitor range, and target margin, with the reasoning made " +
    "explicit. It optimises for defensible margin, not for the highest number: a price the " +
    "positioning cannot support produces traffic that does not convert. Competitor data must be " +
    "sourced, not assumed.",
  scopes: ["research:read"],
  sideEffect: "none",
  input: z.object({
    landedCostMicros: z.number().int().nonnegative(),
    competitorLowMicros: z.number().int().nonnegative(),
    competitorHighMicros: z.number().int().nonnegative(),
    targetMarginPct: z.number().min(0).max(95).default(60),
    positioning: z.enum(["penetration", "premium", "value", "competitive", "anchored"]).default("competitive"),
  }),
  output: z.object({ suggestedMicros: z.number().int(), floorMicros: z.number().int(), rationale: z.string() }),
  idempotent: true,
  timeoutMs: 10_000,
  execute: optimisePrice,
  simulate: optimisePrice,
});

async function optimisePrice(input: {
  landedCostMicros: number; competitorLowMicros: number; competitorHighMicros: number;
  targetMarginPct: number; positioning: string;
}) {
  const floor = Math.round(input.landedCostMicros / (1 - input.targetMarginPct / 100));
  const mid = Math.round((input.competitorLowMicros + input.competitorHighMicros) / 2);
  const anchors: Record<string, number> = {
    penetration: Math.round(input.competitorLowMicros * 0.95),
    premium: Math.round(input.competitorHighMicros * 1.1),
    value: mid,
    competitive: mid,
    anchored: Math.round(input.competitorHighMicros * 0.95),
  };
  const suggested = Math.max(floor, anchors[input.positioning] ?? mid);
  return {
    suggestedMicros: suggested,
    floorMicros: floor,
    rationale:
      suggested === floor
        ? `The margin floor sits above the competitive range, so the price is set by cost rather than by the market. That is a signal the sourcing needs to change, not the price.`
        : `Set from a ${input.positioning} position against a competitor range, and comfortably above the ${input.targetMarginPct}% margin floor.`,
  };
}

export const budgetRequest = defineTool({
  id: "budget.request",
  version: "1.0.0",
  title: "Request additional budget",
  description:
    "Asks the customer to raise a run's budget envelope when a phase cannot complete inside it. " +
    "State what specifically cannot be done and what it unlocks; a request without that reads " +
    "as an open-ended ask and gets refused. This creates a checkpoint and blocks until answered.",
  scopes: ["run:checkpoints"],
  sideEffect: "write",
  input: z.object({
    category: z.enum(["model", "image", "tool", "external"]),
    additionalMicros: z.number().int().positive(),
    reason: z.string().min(10),
    unlocks: z.string().min(5),
  }),
  output: z.object({ approved: z.boolean(), grantedMicros: z.number().int() }),
  idempotent: false,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("budget.request must be bound by the runtime before use.");
  },
  async simulate(input) {
    return { approved: true, grantedMicros: input.additionalMicros };
  },
});

export const financeTools: readonly AnyTool[] = [pnlModel, breakevenCompute, pricingOptimise, budgetRequest];
