import { z } from "zod";
import { defineTool } from "../../core/define.js";
import { seedFor } from "../_helpers.js";

/** Marketplace pricing and saturation research. */
export const marketplaceScan = defineTool({
  id: "marketplace.scan",
  version: "1.0.0",
  title: "Scan a marketplace category",
  description:
    "Samples listings in a marketplace category and returns price distribution, review " +
    "counts, and how saturated the category looks. Use it to sanity-check a price point " +
    "against what buyers already pay. It samples rather than enumerating, so counts are " +
    "estimates and must be carried as sourced claims.",
  scopes: ["research:read"],
  sideEffect: "read",
  input: z.object({
    marketplace: z.enum(["etsy", "amazon", "ebay", "notonthehighstreet"]),
    category: z.string().min(2),
    sample: z.number().int().min(10).max(200).default(60),
  }),
  output: z.object({
    listings: z.number().int().nonnegative(),
    priceMicros: z.object({ p25: z.number().int(), median: z.number().int(), p75: z.number().int() }),
    medianReviews: z.number().int().nonnegative(),
    saturation: z.enum(["low", "moderate", "high", "saturated"]),
  }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("marketplace.scan live adapter is enabled in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "marketplace.scan", input.category);
    const median = rng.int(14, 65);
    return {
      listings: rng.int(120, 9000),
      priceMicros: {
        p25: Math.round(median * 0.7) * 1_000_000,
        median: median * 1_000_000,
        p75: Math.round(median * 1.5) * 1_000_000,
      },
      medianReviews: rng.int(0, 240),
      saturation: rng.pick(["moderate", "high", "saturated"] as const),
    };
  },
});
