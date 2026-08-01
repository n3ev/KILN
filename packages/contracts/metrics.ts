import { z } from "zod";
import { Currency, Timestamp, VentureId } from "./primitives.js";

/**
 * The canonical metric vocabulary — CLAUDE.md §13.
 *
 * Every provider normalises into exactly these keys. Shopify's `total_price`
 * quirks, Stripe's fee handling, GA4's session definition: all of that is the
 * adapter's problem, resolved once, documented inline in the adapter, and
 * covered by tests against real-shaped fixtures. Nothing downstream of the
 * mirror layer may reason about a provider-specific field.
 */
export const MetricKey = z.enum([
  "revenue_gross",
  "revenue_net",
  "orders",
  "units",
  "aov",
  "sessions",
  "conversion_rate",
  "cac",
  "contribution_margin",
  "refund_rate",
  "repeat_rate",
  "inventory_days",
  "ad_spend",
  "roas",
]);
export type MetricKey = z.infer<typeof MetricKey>;

/** How a metric is expressed, so the UI never has to guess at formatting. */
export const MetricUnit = z.enum(["micros", "count", "ratio", "days"]);
export type MetricUnit = z.infer<typeof MetricUnit>;

/** Whether summing across a time range is meaningful. Guards bad rollups. */
export const Aggregation = z.enum(["sum", "average", "ratio", "last"]);
export type Aggregation = z.infer<typeof Aggregation>;

export interface MetricDefinition {
  readonly key: MetricKey;
  readonly label: string;
  readonly unit: MetricUnit;
  readonly aggregation: Aggregation;
  /** Higher is better? Drives colour and anomaly direction. */
  readonly polarity: "up" | "down";
  readonly description: string;
}

export const METRICS: Readonly<Record<MetricKey, MetricDefinition>> = {
  revenue_gross: {
    key: "revenue_gross",
    label: "Gross revenue",
    unit: "micros",
    aggregation: "sum",
    polarity: "up",
    description: "Order value before refunds, after discounts, excluding tax and shipping.",
  },
  revenue_net: {
    key: "revenue_net",
    label: "Net revenue",
    unit: "micros",
    aggregation: "sum",
    polarity: "up",
    description: "Gross revenue less refunds, chargebacks, and processor fees.",
  },
  orders: {
    key: "orders",
    label: "Orders",
    unit: "count",
    aggregation: "sum",
    polarity: "up",
    description: "Paid orders. Excludes cancelled and test orders.",
  },
  units: {
    key: "units",
    label: "Units",
    unit: "count",
    aggregation: "sum",
    polarity: "up",
    description: "Line-item quantity across paid orders.",
  },
  aov: {
    key: "aov",
    label: "Average order value",
    unit: "micros",
    aggregation: "average",
    polarity: "up",
    description: "Gross revenue divided by orders over the same window.",
  },
  sessions: {
    key: "sessions",
    label: "Sessions",
    unit: "count",
    aggregation: "sum",
    polarity: "up",
    description: "Analytics sessions, deduplicated per provider definition.",
  },
  conversion_rate: {
    key: "conversion_rate",
    label: "Conversion rate",
    unit: "ratio",
    aggregation: "ratio",
    polarity: "up",
    description: "Orders divided by sessions. Never summed across ranges.",
  },
  cac: {
    key: "cac",
    label: "Customer acquisition cost",
    unit: "micros",
    aggregation: "ratio",
    polarity: "down",
    description: "Ad spend divided by new customers acquired in the window.",
  },
  contribution_margin: {
    key: "contribution_margin",
    label: "Contribution margin",
    unit: "micros",
    aggregation: "sum",
    polarity: "up",
    description: "Net revenue less COGS, fulfilment, payment fees, and variable ad spend.",
  },
  refund_rate: {
    key: "refund_rate",
    label: "Refund rate",
    unit: "ratio",
    aggregation: "ratio",
    polarity: "down",
    description: "Refunded order value divided by gross revenue.",
  },
  repeat_rate: {
    key: "repeat_rate",
    label: "Repeat rate",
    unit: "ratio",
    aggregation: "ratio",
    polarity: "up",
    description: "Share of orders from customers with a prior order.",
  },
  inventory_days: {
    key: "inventory_days",
    label: "Days of inventory",
    unit: "days",
    aggregation: "last",
    polarity: "up",
    description: "On-hand units divided by trailing 7-day daily sell-through.",
  },
  ad_spend: {
    key: "ad_spend",
    label: "Ad spend",
    unit: "micros",
    aggregation: "sum",
    polarity: "down",
    description: "Paid media spend across connected ad accounts.",
  },
  roas: {
    key: "roas",
    label: "ROAS",
    unit: "ratio",
    aggregation: "ratio",
    polarity: "up",
    description: "Attributed gross revenue divided by ad spend.",
  },
};

export const MetricProvider = z.enum([
  "shopify",
  "stripe",
  "analytics",
  "resend",
  "cal-com",
  "ads",
  "kiln",
]);
export type MetricProvider = z.infer<typeof MetricProvider>;

export const MetricSnapshot = z.object({
  ventureId: VentureId,
  provider: MetricProvider,
  metricKey: MetricKey,
  ts: Timestamp,
  value: z.number().finite(),
  /** Free-form slicing: channel, product, country. Hashed for uniqueness. */
  dimensions: z.record(z.string(), z.string()).default({}),
  currency: Currency.optional(),
});
export type MetricSnapshot = z.infer<typeof MetricSnapshot>;

/** Ratio metrics must never be summed. Callers use this instead of guessing. */
export function combine(key: MetricKey, values: readonly number[]): number {
  if (values.length === 0) return 0;
  const def = METRICS[key];
  switch (def.aggregation) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "average":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "last":
      return values[values.length - 1] ?? 0;
    case "ratio":
      // A ratio cannot be recombined from its own history without the
      // numerator and denominator; the caller must recompute from components.
      // Returning the most recent value is the honest degradation.
      return values[values.length - 1] ?? 0;
  }
}
