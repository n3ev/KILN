import { z } from "zod";
import { LayoutArchetype } from "./brand.js";
import { CountryCode, Micros, Slug, Timestamp } from "./primitives.js";

/**
 * Storefront Engineer output. Tool-heavy, low prose: this artifact is mostly a
 * record of what was actually provisioned, so that handover and replay both
 * have something concrete to work from.
 */

export const StorefrontProvider = z.enum(["shopify", "stripe-checkout", "kiln-site", "cal-com"]);

export const PageKind = z.enum([
  "home",
  "product",
  "collection",
  "about",
  "contact",
  "faq",
  "policy",
  "service-area",
  "booking",
  "landing",
]);

export const PageRecord = z.object({
  kind: PageKind,
  handle: Slug,
  title: z.string().min(1),
  path: z.string().startsWith("/"),
  layoutArchetype: LayoutArchetype,
  /** Blocks in render order. The site generator consumes exactly this. */
  sections: z
    .array(
      z.object({
        type: z.string().min(1),
        /** Section-level content keys resolved against the ContentSet. */
        contentRefs: z.array(z.string()).default([]),
        props: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1),
  published: z.boolean().default(false),
});

export const NavigationItem: z.ZodType<{
  label: string;
  path: string;
  children?: { label: string; path: string; children?: unknown[] }[];
}> = z.lazy(() =>
  z.object({
    label: z.string().min(1),
    path: z.string().min(1),
    children: z.array(NavigationItem).optional(),
  }),
);

export const ShippingConfig = z.object({
  profiles: z.array(z.string().min(1)).min(1),
  originCountry: CountryCode,
  handlingFeeMicros: Micros.default(0),
});

export const TaxConfig = z.object({
  mode: z.enum(["automatic", "manual", "not-registered"]),
  registrations: z.array(z.object({ country: CountryCode, id: z.string().optional() })).default([]),
  pricesIncludeTax: z.boolean(),
  /** Recorded so the compliance report can cross-check it. */
  notes: z.string().optional(),
});

export const PaymentsConfig = z.object({
  provider: z.enum(["shopify-payments", "stripe", "manual"]),
  methods: z.array(z.string().min(1)).min(1),
  testModeVerified: z.boolean().default(false),
  /** KILN never holds card data; this records which entity is the MOR. */
  merchantOfRecord: z.enum(["customer", "platform", "provider"]),
});

/**
 * Theme edits are never applied to a live theme. §10 requires duplicate →
 * write → validate → publish atomically, and this record proves which theme id
 * was staged and which was published, so a bad publish is one call to undo.
 */
export const ThemeStaging = z.object({
  baseThemeId: z.string().min(1),
  stagedThemeId: z.string().min(1),
  assetsWritten: z.array(z.string()).default([]),
  validated: z.boolean().default(false),
  publishedThemeId: z.string().optional(),
  previousLiveThemeId: z.string().optional(),
});

export const StorefrontBuild = z.object({
  provider: StorefrontProvider,
  /** Null until the store actually exists — sandbox runs carry a fake id. */
  externalStoreId: z.string().optional(),
  storefrontUrl: z.string().url().optional(),
  customDomain: z.string().optional(),
  sandbox: z.boolean(),

  pages: z.array(PageRecord).min(1),
  navigation: z.object({
    primary: z.array(NavigationItem).min(1),
    footer: z.array(NavigationItem).min(1),
  }),
  theme: ThemeStaging.optional(),
  shipping: ShippingConfig.optional(),
  tax: TaxConfig,
  payments: PaymentsConfig,
  discounts: z
    .array(z.object({ code: z.string().min(1), kind: z.enum(["percentage", "fixed", "shipping"]), value: z.number() }))
    .default([]),

  /** Every external object KILN created, for handover and teardown. */
  provisionedObjects: z
    .array(
      z.object({
        kind: z.string().min(1),
        externalId: z.string().min(1),
        label: z.string().min(1),
      }),
    )
    .default([]),

  publishedAt: Timestamp.optional(),
  generatedAt: Timestamp,
});
export type StorefrontBuild = z.infer<typeof StorefrontBuild>;
export type PageRecord = z.infer<typeof PageRecord>;
