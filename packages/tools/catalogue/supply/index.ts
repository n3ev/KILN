import { z } from "zod";
import { defineTool, type AnyTool } from "../../core/define.js";
import { fakeId, isoFor, seedFor, units } from "../_helpers.js";

/** Sourcing: supplier discovery, quotes, landed cost, and fulfilment setup. */

export const supplierSearch = defineTool({
  id: "supplier.search",
  version: "1.0.0",
  title: "Find suppliers",
  description:
    "Finds suppliers able to make or fulfil a product, across print-on-demand networks and " +
    "wholesale directories. Returns candidates with country, minimum order quantity, and " +
    "certifications. It does not obtain prices \u2014 call supplier.quote for that, per supplier, " +
    "because quotes depend on quantity and specification. Print-on-demand candidates have an " +
    "MOQ of 1 and higher unit cost; wholesale is the reverse, and the trade-off between them " +
    "belongs in the fulfilment trade-off memo, not in this tool.",
  scopes: ["supply:read"],
  sideEffect: "read",
  input: z.object({
    productDescription: z.string().min(5),
    kinds: z.array(z.enum(["print-on-demand", "wholesale", "manufacturer", "dropship", "local-maker"])).default(["print-on-demand", "wholesale"]),
    shipTo: z.string().length(2),
    limit: z.number().int().min(1).max(30).default(8),
  }),
  output: z.object({
    suppliers: z.array(z.object({
      name: z.string(),
      kind: z.string(),
      adapter: z.string().optional(),
      country: z.string().length(2),
      moq: z.number().int().nonnegative(),
      leadTimeDays: z.number().int().nonnegative(),
      certifications: z.array(z.string()),
    })),
  }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("supplier.search live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "supplier.search", input.productDescription);
    const pod = [
      { name: "Printful", adapter: "printful", country: "LV", moq: 1 },
      { name: "Printify", adapter: "printify", country: "US", moq: 1 },
      { name: "Gelato", adapter: "gelato", country: "NO", moq: 1 },
    ];
    const wholesale = [
      { name: "Northgate Ceramics", adapter: "generic-wholesale", country: "PT", moq: 150 },
      { name: "Baltic Woodworks", adapter: "generic-wholesale", country: "EE", moq: 250 },
      { name: "Shenzhen Fulfil Co", adapter: "generic-wholesale", country: "CN", moq: 500 },
    ];
    const pool = [
      ...(input.kinds.includes("print-on-demand") ? pod.map((s) => ({ ...s, kind: "print-on-demand" })) : []),
      ...(input.kinds.includes("wholesale") ? wholesale.map((s) => ({ ...s, kind: "wholesale" })) : []),
    ];
    return {
      suppliers: rng.shuffle(pool).slice(0, input.limit).map((s) => ({
        name: s.name,
        kind: s.kind,
        adapter: s.adapter,
        country: s.country,
        moq: s.moq,
        leadTimeDays: s.kind === "print-on-demand" ? rng.int(3, 9) : rng.int(18, 45),
        certifications: rng.bool(0.5) ? ["OEKO-TEX"] : [],
      })),
    };
  },
});

export const supplierQuote = defineTool({
  id: "supplier.quote",
  version: "1.0.0",
  title: "Get a supplier quote",
  description:
    "Requests priced tiers from one supplier for one specification. This is the QUOTE half of " +
    "the two-phase spend pattern: it costs nothing and returns a `quoteId` that sample.order " +
    "later requires. Always request several quantity tiers \u2014 a single-quantity quote hides " +
    "the actual decision, which is how much capital to put at risk before the first sale. " +
    "Setup fees are separate from unit cost and are easy to miss in a margin model.",
  scopes: ["supply:read"],
  sideEffect: "read",
  input: z.object({
    supplierName: z.string().min(1),
    sku: z.string().min(1),
    specification: z.string().min(5),
    quantities: z.array(z.number().int().positive()).min(1).default([1, 50, 250, 1000]),
    currency: z.string().length(3).default("GBP"),
  }),
  output: z.object({
    quoteId: z.string(),
    supplierName: z.string(),
    currency: z.string(),
    tiers: z.array(z.object({ quantity: z.number().int(), unitCostMicros: z.number().int(), leadTimeDays: z.number().int() })),
    moq: z.number().int(),
    setupFeeMicros: z.number().int(),
    sampleCostMicros: z.number().int(),
    validUntil: z.string(),
  }),
  idempotent: true,
  timeoutMs: 45_000,
  async execute() {
    throw new Error("supplier.quote live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "supplier.quote", input.supplierName + input.sku);
    const base = rng.int(4, 22);
    return {
      quoteId: fakeId(rng, "sq"),
      supplierName: input.supplierName,
      currency: input.currency,
      // Unit cost falls with volume on a decaying curve, as real price breaks do.
      tiers: input.quantities.map((quantity) => ({
        quantity,
        unitCostMicros: units(Math.max(1.2, base * Math.pow(quantity, -0.13))),
        leadTimeDays: quantity <= 1 ? rng.int(3, 8) : rng.int(14, 42),
      })),
      moq: rng.pick([1, 1, 50, 150, 300]),
      setupFeeMicros: rng.bool(0.4) ? units(rng.int(40, 400)) : 0,
      sampleCostMicros: units(rng.int(6, 40)),
      validUntil: isoFor(ctx, `supplier.quote:${input.supplierName}:${input.sku}`, 30),
    };
  },
});

export const landedCostModel = defineTool({
  id: "landedCost.model",
  version: "1.0.0",
  title: "Model landed cost",
  description:
    "Decomposes the true per-unit cost of getting stock into a shippable state: unit cost, " +
    "freight, duty, and handling. Use the landed figure in every margin calculation \u2014 a model " +
    "built on the supplier's unit price alone overstates contribution margin by the amount " +
    "that most often turns a viable product into an unviable one. Duty rates vary by " +
    "commodity code and destination and are estimates here, not customs rulings.",
  scopes: ["supply:read"],
  sideEffect: "none",
  input: z.object({
    sku: z.string().min(1),
    quantity: z.number().int().positive(),
    unitCostMicros: z.number().int().nonnegative(),
    originCountry: z.string().length(2),
    destinationCountry: z.string().length(2),
    unitWeightGrams: z.number().positive(),
    currency: z.string().length(3).default("GBP"),
  }),
  output: z.object({
    sku: z.string(),
    quantity: z.number().int(),
    currency: z.string(),
    unitCostMicros: z.number().int(),
    freightPerUnitMicros: z.number().int(),
    dutyPerUnitMicros: z.number().int(),
    handlingPerUnitMicros: z.number().int(),
    landedUnitCostMicros: z.number().int(),
  }),
  idempotent: true,
  timeoutMs: 10_000,
  execute: modelLandedCost,
  simulate: modelLandedCost,
});

async function modelLandedCost(input: {
  sku: string; quantity: number; unitCostMicros: number; originCountry: string;
  destinationCountry: string; unitWeightGrams: number; currency: string;
}) {
  const domestic = input.originCountry === input.destinationCountry;
  // Freight per unit falls with volume; duty is nil domestically.
  const freightPerUnitMicros = Math.round(
    (input.unitWeightGrams / 1000) * units(domestic ? 1.2 : 3.4) * (input.quantity > 250 ? 0.6 : 1),
  );
  const dutyPerUnitMicros = domestic ? 0 : Math.round(input.unitCostMicros * 0.045);
  const handlingPerUnitMicros = Math.round(units(0.35) + input.unitCostMicros * 0.01);
  return {
    sku: input.sku,
    quantity: input.quantity,
    currency: input.currency,
    unitCostMicros: input.unitCostMicros,
    freightPerUnitMicros,
    dutyPerUnitMicros,
    handlingPerUnitMicros,
    landedUnitCostMicros: input.unitCostMicros + freightPerUnitMicros + dutyPerUnitMicros + handlingPerUnitMicros,
  };
}

export const sampleOrder = defineTool({
  id: "sample.order",
  version: "1.0.0",
  title: "Order a sample",
  description:
    "Places a real sample order against a supplier quote. SPENDS REAL MONEY and requires an " +
    "authorisation id plus the matching `quoteId`. Ordering a sample before committing to an " +
    "MOQ run is almost always the right call: it is the cheapest way to discover that the " +
    "finish is wrong. Delivery takes days to weeks, so the run does not wait on it.",
  scopes: ["supply:order", "spend:external"],
  sideEffect: "spend",
  input: z.object({
    supplierName: z.string().min(1),
    sku: z.string().min(1),
    quoteId: z.string().min(1),
    shipTo: z.object({ name: z.string(), line1: z.string(), city: z.string(), postcode: z.string(), country: z.string().length(2) }),
  }),
  output: z.object({ orderId: z.string(), trackingUrl: z.string().optional(), estimatedArrival: z.string(), paidMicros: z.number().int() }),
  costEstimate: () => units(45),
  idempotent: true,
  idempotencyIgnore: ["quoteId"],
  timeoutMs: 60_000,
  async execute() {
    throw new Error("sample.order live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "sample.order", input.sku);
    return {
      orderId: fakeId(rng, "so"),
      trackingUrl: `https://tracking.example-carrier.co/${fakeId(rng, "trk", 10)}`,
      estimatedArrival: isoFor(ctx, `sample.order:${input.sku}`, rng.int(4, 18)),
      paidMicros: units(rng.int(8, 60)),
    };
  },
});

export const moqEvaluate = defineTool({
  id: "moq.evaluate",
  version: "1.0.0",
  title: "Evaluate a minimum order quantity",
  description:
    "Compares a supplier MOQ with available capital, expected early demand, and the target margin. It does not place an order; it exposes cash at risk and unsold-stock exposure for the fulfilment trade-off gate.",
  scopes: ["supply:read"],
  sideEffect: "none",
  input: z.object({
    moq: z.number().int().nonnegative(),
    unitCostMicros: z.number().int().nonnegative(),
    landedUnitCostMicros: z.number().int().nonnegative(),
    sellingPriceMicros: z.number().int().positive(),
    availableCapitalMicros: z.number().int().nonnegative(),
    expectedUnitsFirst90Days: z.number().int().nonnegative(),
  }),
  output: z.object({
    feasible: z.boolean(),
    capitalRequiredMicros: z.number().int(),
    contributionMarginMicros: z.number().int(),
    inventoryAtRiskUnits: z.number().int(),
    inventoryAtRiskMicros: z.number().int(),
    recommendation: z.enum(["accept-moq", "negotiate", "use-pod", "reject"]),
    reason: z.string(),
  }),
  idempotent: true,
  timeoutMs: 10_000,
  execute: evaluateMoq,
  simulate: evaluateMoq,
});

async function evaluateMoq(input: {
  moq: number;
  unitCostMicros: number;
  landedUnitCostMicros: number;
  sellingPriceMicros: number;
  availableCapitalMicros: number;
  expectedUnitsFirst90Days: number;
}) {
  const capitalRequiredMicros = input.moq * input.unitCostMicros;
  const contributionMarginMicros = input.sellingPriceMicros - input.landedUnitCostMicros;
  const inventoryAtRiskUnits = Math.max(0, input.moq - input.expectedUnitsFirst90Days);
  const inventoryAtRiskMicros = inventoryAtRiskUnits * input.landedUnitCostMicros;
  const affordable = capitalRequiredMicros <= input.availableCapitalMicros;
  const positive = contributionMarginMicros > 0;
  const demandCoversMost = input.moq === 0 || input.expectedUnitsFirst90Days / input.moq >= 0.7;
  const recommendation = !positive
    ? "reject"
    : !affordable
      ? "use-pod"
      : demandCoversMost
        ? "accept-moq"
        : "negotiate";
  return {
    feasible: affordable && positive,
    capitalRequiredMicros,
    contributionMarginMicros,
    inventoryAtRiskUnits,
    inventoryAtRiskMicros,
    recommendation,
    reason:
      recommendation === "accept-moq"
        ? "Available capital covers the order and forecast demand absorbs at least 70% within 90 days."
        : recommendation === "negotiate"
          ? "The order is affordable, but too much stock remains exposed under the 90-day demand estimate."
          : recommendation === "use-pod"
            ? "The quoted order exceeds the capital available before revenue."
            : "The configured selling price does not cover landed unit cost.",
  } as const;
}

export const fulfilmentConfigure = defineTool({
  id: "fulfilment.configure",
  version: "1.0.0",
  title: "Configure fulfilment",
  description:
    "Connects a supplier's fulfilment to the storefront so paid orders route automatically. " +
    "Must match the shipping rates already configured \u2014 a print-on-demand partner quoting " +
    "nine days behind a storefront promising three produces refunds, not sales. Returns the " +
    "routing rules actually created so the QA phase can verify them.",
  scopes: ["supply:order", "commerce:write"],
  sideEffect: "write",
  input: z.object({
    supplierName: z.string().min(1),
    adapter: z.string().min(1),
    skus: z.array(z.string()).min(1),
    autoRoutePaidOrders: z.boolean().default(true),
  }),
  output: z.object({ connectionId: z.string(), routedSkus: z.array(z.string()), autoRouting: z.boolean() }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("fulfilment.configure live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    return {
      connectionId: fakeId(seedFor(ctx, "fulfilment", input.supplierName), "ful"),
      routedSkus: input.skus,
      autoRouting: input.autoRoutePaidOrders,
    };
  },
});

export const supplyTools: readonly AnyTool[] = [supplierSearch, supplierQuote, landedCostModel, moqEvaluate, sampleOrder, fulfilmentConfigure];
