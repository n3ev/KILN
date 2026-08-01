import { z } from "zod";
import { Currency, Micros, Slug, Timestamp } from "./primitives.js";
import { SourceRef } from "./sources.js";

/** Product Architect output. Covers goods, digital deliverables, and services. */

export const VariantOption = z.object({
  name: z.string().min(1),
  values: z.array(z.string().min(1)).min(1),
});

export const Variant = z.object({
  sku: z.string().min(1),
  /** Option name -> value, e.g. { Size: "Large", Colour: "Bone" }. */
  options: z.record(z.string(), z.string()),
  priceMicros: Micros,
  compareAtMicros: Micros.optional(),
  costMicros: Micros.optional(),
  weightGrams: z.number().nonnegative().optional(),
  dimensionsMm: z.object({ l: z.number(), w: z.number(), h: z.number() }).optional(),
  inventoryPolicy: z.enum(["track", "continue", "made-to-order"]).default("track"),
  barcode: z.string().optional(),
});

export const ProductImageBrief = z.object({
  role: z.enum(["hero", "detail", "in-scene", "on-model", "scale", "packaging"]),
  /** Prompt fragment; combined with the brand visual direction at generation. */
  brief: z.string().min(1),
  aspectRatio: z.enum(["1:1", "4:5", "3:2", "16:9"]),
  /** Populated once generated and passed image.qualityCheck. */
  storageKey: z.string().optional(),
  altText: z.string().optional(),
});

export const Product = z.object({
  handle: Slug,
  title: z.string().min(1),
  /** Quality gate requires 120+ words that pass the slop linter. */
  description: z.string().min(1),
  shortDescription: z.string().min(1).max(300),
  productType: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  options: z.array(VariantOption).default([]),
  variants: z.array(Variant).min(1),
  /** Minimum three distinct images — enforced at the pre-launch gate. */
  images: z.array(ProductImageBrief).min(3),
  /** Buyer-facing specifics. The antidote to generic product copy. */
  specifications: z.array(z.object({ label: z.string().min(1), value: z.string().min(1) })).default([]),
  careInstructions: z.string().optional(),
  seo: z.object({ title: z.string().min(1).max(70), description: z.string().min(1).max(160) }),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
});
export type Product = z.infer<typeof Product>;

export const Collection = z.object({
  handle: Slug,
  title: z.string().min(1),
  description: z.string().min(1),
  productHandles: z.array(Slug).min(1),
  /** Why this grouping exists commercially, not just taxonomically. */
  merchandisingRationale: z.string().min(1),
});

export const Bundle = z.object({
  handle: Slug,
  title: z.string().min(1),
  componentSkus: z.array(z.string().min(1)).min(2),
  priceMicros: Micros,
  savingMicros: Micros,
  rationale: z.string().min(1),
});

/** Digital archetype: what the buyer downloads or logs into. */
export const DigitalDeliverable = z.object({
  handle: Slug,
  title: z.string().min(1),
  format: z.enum(["notion-template", "figma-file", "pdf", "spreadsheet", "course", "software", "asset-pack"]),
  /** The actual contents KILN produces, not a description of them. */
  components: z.array(z.object({ name: z.string().min(1), description: z.string().min(1) })).min(1),
  deliveryMechanism: z.enum(["signed-download", "members-area", "email-drip", "external-link"]),
  licenceTerms: z.string().min(1),
  updatePolicy: z.string().min(1),
});

/** Service archetype: what is booked, for how long, at what price. */
export const ServiceItem = z.object({
  handle: Slug,
  title: z.string().min(1),
  description: z.string().min(1),
  durationMinutes: z.number().int().positive(),
  priceMicros: Micros,
  priceModel: z.enum(["fixed", "from", "hourly", "quote-only"]),
  /** Travel, parking, parts: the costs that quietly eat service margin. */
  variableCostMicros: Micros.optional(),
  requiresQuote: z.boolean().default(false),
  prerequisites: z.array(z.string()).default([]),
});

export const ProductCatalogue = z.object({
  currency: Currency,
  products: z.array(Product).default([]),
  collections: z.array(Collection).default([]),
  bundles: z.array(Bundle).default([]),
  digitalDeliverables: z.array(DigitalDeliverable).default([]),
  services: z.array(ServiceItem).default([]),
  /** The one thing the business leads with. Drives the whole storefront. */
  heroHandle: Slug,
  merchandisingNotes: z.string().min(1),
  pricingEvidence: z.array(SourceRef).min(1),
  generatedAt: Timestamp,
}).refine(
  (c) =>
    c.products.length > 0 || c.digitalDeliverables.length > 0 || c.services.length > 0,
  { message: "a catalogue must contain at least one sellable item" },
);
export type ProductCatalogue = z.infer<typeof ProductCatalogue>;
