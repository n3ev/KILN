import { z } from "zod";
import { CountryCode, Currency, Micros, Timestamp } from "./primitives.js";
import { SourceRef } from "./sources.js";

/** Supply Officer output. Physical archetype only. */

export const SupplierKind = z.enum(["print-on-demand", "wholesale", "manufacturer", "dropship", "local-maker"]);

export const Supplier = z.object({
  name: z.string().min(1),
  kind: SupplierKind,
  /** Adapter id when KILN can transact programmatically. */
  adapter: z.enum(["printful", "printify", "gelato", "generic-wholesale", "manual"]).optional(),
  country: CountryCode,
  url: z.string().url().optional(),
  productionCountries: z.array(CountryCode).default([]),
  certifications: z.array(z.string()).default([]),
  evidence: z.array(SourceRef).min(1),
});

export const Quote = z.object({
  supplierName: z.string().min(1),
  sku: z.string().min(1),
  currency: Currency,
  /** Price breaks. A single-quantity quote hides the real decision. */
  tiers: z
    .array(
      z.object({
        quantity: z.number().int().positive(),
        unitCostMicros: Micros,
        leadTimeDays: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  moq: z.number().int().nonnegative(),
  setupFeeMicros: Micros.default(0),
  sampleCostMicros: Micros.optional(),
  validUntil: Timestamp.optional(),
  /** Ties the eventual spend commit back to this exact quote — §9.3. */
  quoteId: z.string().min(1),
});

export const LandedCost = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
  currency: Currency,
  unitCostMicros: Micros,
  freightPerUnitMicros: Micros,
  dutyPerUnitMicros: Micros,
  handlingPerUnitMicros: Micros,
  /** Everything to get one unit into a shippable state. */
  landedUnitCostMicros: Micros,
  assumptions: z.array(SourceRef).min(1),
});

/**
 * The MOQ-vs-POD trade-off memo. CLAUDE.md §11.2 requires this as an explicit
 * artifact routed through a hard gate — it is the decision that determines how
 * much of the customer's money is at risk before the first sale, so it is never
 * made silently inside an agent.
 */
export const FulfilmentTradeoff = z.object({
  options: z
    .array(
      z.object({
        model: z.enum(["print-on-demand", "moq-batch", "hybrid"]),
        capitalRequiredMicros: Micros,
        marginByTier: z
          .array(z.object({ quantity: z.number().int().positive(), marginPct: z.number() }))
          .min(1),
        timeToFirstSaleDays: z.number().int().nonnegative(),
        inventoryRiskMicros: Micros,
        qualityCeiling: z.enum(["low", "moderate", "high"]),
        reversibility: z.enum(["easy", "costly", "locked-in"]),
        notes: z.string().min(1),
      }),
    )
    .min(2),
  recommendation: z.enum(["print-on-demand", "moq-batch", "hybrid"]),
  reasoning: z.string().min(1),
  /** What would change the recommendation. Makes the gate a real decision. */
  wouldChangeIf: z.string().min(1),
});
export type FulfilmentTradeoff = z.infer<typeof FulfilmentTradeoff>;

export const ShippingProfile = z.object({
  name: z.string().min(1),
  zones: z
    .array(
      z.object({
        name: z.string().min(1),
        countries: z.array(CountryCode).min(1),
        rates: z
          .array(
            z.object({
              label: z.string().min(1),
              minWeightGrams: z.number().nonnegative(),
              maxWeightGrams: z.number().positive(),
              priceMicros: Micros,
              transitDaysMin: z.number().int().nonnegative(),
              transitDaysMax: z.number().int().nonnegative(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  freeShippingThresholdMicros: Micros.optional(),
});

export const SupplyPlan = z.object({
  suppliers: z.array(Supplier).min(1),
  shortlist: z
    .array(z.object({ supplierName: z.string().min(1), rank: z.number().int().positive(), why: z.string().min(1) }))
    .min(1),
  quotes: z.array(Quote).min(1),
  landedCosts: z.array(LandedCost).min(1),
  tradeoff: FulfilmentTradeoff,
  shippingProfiles: z.array(ShippingProfile).min(1),
  /** Must be consistent with the fulfilment model — checked at the QA gate. */
  returnsPolicy: z.object({
    windowDays: z.number().int().nonnegative(),
    condition: z.string().min(1),
    whoPaysReturn: z.enum(["customer", "merchant", "shared"]),
    restockingFeePct: z.number().min(0).max(100).default(0),
    exceptions: z.array(z.string()).default([]),
  }),
  sampleOrders: z
    .array(z.object({ supplierName: z.string(), sku: z.string(), status: z.enum(["proposed", "ordered", "received"]) }))
    .default([]),
  generatedAt: Timestamp,
});
export type SupplyPlan = z.infer<typeof SupplyPlan>;
