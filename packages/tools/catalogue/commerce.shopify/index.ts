import { z } from "zod";
import { defineTool, type AnyTool } from "../../core/define.js";
import { fakeId, isoFor, requireLive, seedFor, slugify } from "../_helpers.js";
import { shopifyConfigurationTools } from "./configuration.js";

/**
 * Shopify.
 *
 * One rule dominates this domain: **never patch a live theme in place.**
 * Shopify's theme model expects whole-asset writes, so a partial write against
 * the published theme is visible to shoppers mid-edit and is not atomically
 * revertible. Every theme change duplicates to an unpublished theme, writes
 * there, validates, and then publishes atomically — theme.stageEdit does this
 * and store.publish flips it.
 */

const money = z.object({ micros: z.number().int(), currency: z.string().length(3) });

export const storeProvision = defineTool({
  id: "shopify.store.provision",
  version: "1.0.0",
  title: "Provision a Shopify store",
  description:
    "Creates a development store under KILN's partner organisation and returns its admin " +
    "handle and myshopify domain. Under managed ownership KILN holds the store on the " +
    "customer's behalf and it is transferable to them at any time. This does not choose a " +
    "plan or enter billing details — the store stays on a development plan until the customer " +
    "authorises the upgrade at the publish gate.",
  scopes: ["commerce:write"],
  sideEffect: "write",
  input: z.object({
    name: z.string().min(1),
    countryCode: z.string().length(2),
    currency: z.string().length(3),
  }),
  output: z.object({
    storeId: z.string(),
    myshopifyDomain: z.string(),
    adminUrl: z.string().url(),
    plan: z.string(),
  }),
  idempotent: true,
  timeoutMs: 120_000,
  async execute() {
    requireLive("shopify.store.provision", "shopifyLiveProvisioning", "Requires a Shopify Partner account.");
    throw new Error("shopify.store.provision live adapter is wired in prompt 2.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "shopify.store.provision", input.name);
    const handle = `${slugify(input.name)}-${rng.int(100, 999)}`;
    return {
      storeId: fakeId(rng, "shop"),
      myshopifyDomain: `${handle}.myshopify.com`,
      adminUrl: `https://admin.shopify.com/store/${handle}`,
      plan: "development",
    };
  },
});

export const productUpsert = defineTool({
  id: "shopify.product.upsert",
  version: "1.0.0",
  title: "Create or update a product",
  description:
    "Creates a product, or updates it if one with the same handle exists. Variants are " +
    "replaced wholesale, not merged: send the complete variant list every time, or variants " +
    "you omit will be removed. Prices are integer micros and are converted at the boundary. " +
    "Products are created as drafts unless `status` says otherwise, so nothing becomes " +
    "shoppable before the publish gate.",
  scopes: ["commerce:write"],
  sideEffect: "write",
  input: z.object({
    handle: z.string().min(1),
    title: z.string().min(1),
    descriptionHtml: z.string().min(1),
    productType: z.string().optional(),
    tags: z.array(z.string()).default([]),
    status: z.enum(["draft", "active", "archived"]).default("draft"),
    variants: z
      .array(
        z.object({
          sku: z.string().min(1),
          price: money,
          compareAtPrice: money.optional(),
          weightGrams: z.number().nonnegative().optional(),
          options: z.record(z.string(), z.string()).default({}),
          inventoryPolicy: z.enum(["track", "continue", "made-to-order"]).default("track"),
        }),
      )
      .min(1),
    images: z.array(z.object({ storageKey: z.string(), altText: z.string() })).default([]),
    seo: z.object({ title: z.string(), description: z.string() }).optional(),
  }),
  output: z.object({
    productId: z.string(),
    handle: z.string(),
    variantIds: z.array(z.string()),
    status: z.string(),
    created: z.boolean(),
  }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    requireLive("shopify.product.upsert", "shopifyLiveProvisioning", "Requires a connected store.");
    throw new Error("shopify.product.upsert live adapter is wired in prompt 2.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "shopify.product.upsert", input.handle);
    return {
      productId: fakeId(rng, "prod"),
      handle: input.handle,
      variantIds: input.variants.map(() => fakeId(rng, "var")),
      status: input.status,
      created: true,
    };
  },
});

export const themeStageEdit = defineTool({
  id: "shopify.theme.stageEdit",
  version: "1.0.0",
  title: "Stage theme edits on an unpublished copy",
  description:
    "Duplicates the live theme to an unpublished copy, writes the given assets to that copy, " +
    "and validates it. It NEVER touches the published theme — Shopify expects whole-asset " +
    "writes, so editing live is visible to shoppers mid-change and cannot be reverted " +
    "atomically. Returns the staged theme id and a preview URL; call shopify.store.publish to " +
    "swap it in, which is a separate, approval-gated step.",
  scopes: ["commerce:write"],
  sideEffect: "write",
  input: z.object({
    baseThemeId: z.string().optional(),
    assets: z.array(z.object({ key: z.string().min(1), value: z.string() })).min(1),
    themeName: z.string().default("KILN staged"),
  }),
  output: z.object({
    stagedThemeId: z.string(),
    baseThemeId: z.string(),
    previewUrl: z.string().url(),
    assetsWritten: z.array(z.string()),
    validated: z.boolean(),
  }),
  idempotent: true,
  timeoutMs: 120_000,
  async execute() {
    requireLive("shopify.theme.stageEdit", "shopifyLiveProvisioning", "Requires a connected store.");
    throw new Error("shopify.theme.stageEdit live adapter is wired in prompt 2.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "shopify.theme.stageEdit", input.themeName);
    const staged = fakeId(rng, "theme");
    return {
      stagedThemeId: staged,
      baseThemeId: input.baseThemeId ?? fakeId(rng, "theme"),
      previewUrl: `https://simulated.myshopify.com/?preview_theme_id=${staged}`,
      assetsWritten: input.assets.map((a) => a.key),
      validated: true,
    };
  },
});

export const storePublish = defineTool({
  id: "shopify.store.publish",
  version: "1.0.0",
  title: "Publish the store",
  description:
    "Makes the storefront publicly shoppable: publishes the staged theme atomically, removes " +
    "the password page, and activates products marked for release. THIS IS VISIBLE TO THE " +
    "PUBLIC IMMEDIATELY and always requires approval unless the run is autonomous with a " +
    "standing authorisation. Returns the previous theme id so the change can be rolled back " +
    "in one call.",
  scopes: ["commerce:publish"],
  sideEffect: "publish",
  input: z.object({
    stagedThemeId: z.string().min(1),
    removePasswordPage: z.boolean().default(true),
    activateProductHandles: z.array(z.string()).default([]),
  }),
  output: z.object({
    publishedThemeId: z.string(),
    previousLiveThemeId: z.string(),
    storefrontUrl: z.string().url(),
    publishedAt: z.string(),
  }),
  idempotent: false,
  timeoutMs: 60_000,
  async execute() {
    requireLive("shopify.store.publish", "shopifyLiveProvisioning", "Requires a connected store.");
    throw new Error("shopify.store.publish live adapter is wired in prompt 2.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "shopify.store.publish", input.stagedThemeId);
    return {
      publishedThemeId: input.stagedThemeId,
      previousLiveThemeId: fakeId(rng, "theme"),
      storefrontUrl: "https://simulated.myshopify.com",
      publishedAt: isoFor(ctx, `shopify.publish:${input.stagedThemeId}`),
    };
  },
});

export const shippingConfigure = defineTool({
  id: "shopify.shipping.configure",
  version: "1.0.0",
  title: "Configure shipping profiles",
  description:
    "Sets shipping zones and weight-banded rates. Rates must be consistent with the fulfilment " +
    "model in the supply plan — quoting two-day delivery on a print-on-demand range that takes " +
    "nine days is the fastest route to refunds and chargebacks. Weights are grams; prices are " +
    "micros. Replaces existing profiles with the ones supplied.",
  scopes: ["commerce:write"],
  sideEffect: "write",
  input: z.object({
    originCountry: z.string().length(2),
    profiles: z
      .array(
        z.object({
          name: z.string().min(1),
          zones: z.array(
            z.object({
              name: z.string().min(1),
              countries: z.array(z.string().length(2)).min(1),
              rates: z.array(
                z.object({
                  label: z.string().min(1),
                  minWeightGrams: z.number().nonnegative(),
                  maxWeightGrams: z.number().positive(),
                  price: money,
                }),
              ),
            }),
          ),
        }),
      )
      .min(1),
  }),
  output: z.object({ profileIds: z.array(z.string()), zoneCount: z.number().int() }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    requireLive("shopify.shipping.configure", "shopifyLiveProvisioning", "Requires a connected store.");
    throw new Error("shopify.shipping.configure live adapter is wired in prompt 2.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "shopify.shipping.configure", input.originCountry);
    return {
      profileIds: input.profiles.map(() => fakeId(rng, "prof")),
      zoneCount: input.profiles.reduce((n, p) => n + p.zones.length, 0),
    };
  },
});

export const pageUpsert = defineTool({
  id: "shopify.page.upsert",
  version: "1.0.0",
  title: "Create or update a page",
  description:
    "Creates or updates a content page (about, FAQ, policies, contact) by handle. Body is " +
    "HTML. Policy pages created here must name the correct legal entity and jurisdiction — " +
    "the pre-launch quality gate checks this and will block the run on placeholders.",
  scopes: ["commerce:write"],
  sideEffect: "write",
  input: z.object({
    handle: z.string().min(1),
    title: z.string().min(1),
    bodyHtml: z.string().min(1),
    published: z.boolean().default(false),
  }),
  output: z.object({ pageId: z.string(), handle: z.string(), url: z.string() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    requireLive("shopify.page.upsert", "shopifyLiveProvisioning", "Requires a connected store.");
    throw new Error("shopify.page.upsert live adapter is wired in prompt 2.");
  },
  async simulate(input, ctx) {
    return {
      pageId: fakeId(seedFor(ctx, "shopify.page.upsert", input.handle), "page"),
      handle: input.handle,
      url: `/pages/${input.handle}`,
    };
  },
});

export const collectionUpsert = defineTool({
  id: "shopify.collection.upsert",
  version: "1.0.0",
  title: "Create or update a collection",
  description:
    "Creates or updates a product collection by handle and sets its members. Collections are " +
    "a merchandising decision, not a taxonomy exercise — group by what a buyer is trying to " +
    "do, not by what the product is made of.",
  scopes: ["commerce:write"],
  sideEffect: "write",
  input: z.object({
    handle: z.string().min(1),
    title: z.string().min(1),
    descriptionHtml: z.string().default(""),
    productHandles: z.array(z.string()).default([]),
  }),
  output: z.object({ collectionId: z.string(), handle: z.string(), productCount: z.number().int() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    requireLive("shopify.collection.upsert", "shopifyLiveProvisioning", "Requires a connected store.");
    throw new Error("shopify.collection.upsert live adapter is wired in prompt 2.");
  },
  async simulate(input, ctx) {
    return {
      collectionId: fakeId(seedFor(ctx, "shopify.collection.upsert", input.handle), "col"),
      handle: input.handle,
      productCount: input.productHandles.length,
    };
  },
});

export const storeTransferOwnership = defineTool({
  id: "shopify.store.transferOwnership",
  version: "1.0.0",
  title: "Transfer store ownership to the customer",
  description:
    "Moves store ownership to the customer's Shopify account, detaches KILN billing, and " +
    "removes KILN staff accounts. VERIFIES the customer can log in before reporting success — " +
    "a handover marked complete that the customer cannot actually access is worse than one " +
    "that failed loudly. This is irreversible without the customer re-delegating access.",
  scopes: ["commerce:transfer"],
  sideEffect: "destructive",
  input: z.object({
    customerEmail: z.string().email(),
    removeStaffAccounts: z.boolean().default(true),
    detachBilling: z.boolean().default(true),
  }),
  output: z.object({
    transferred: z.boolean(),
    verifiedCustomerAccess: z.boolean(),
    newOwnerEmail: z.string(),
    completedAt: z.string(),
  }),
  idempotent: false,
  timeoutMs: 120_000,
  async execute() {
    requireLive("shopify.store.transferOwnership", "shopifyLiveProvisioning", "Requires a connected store.");
    throw new Error("shopify.store.transferOwnership live adapter is wired in prompt 2.");
  },
  async simulate(input, ctx) {
    return {
      transferred: true,
      verifiedCustomerAccess: true,
      newOwnerEmail: input.customerEmail,
      completedAt: isoFor(ctx, `shopify.transfer:${input.customerEmail}`),
    };
  },
});

export const shopifyTools: readonly AnyTool[] = [
  storeProvision,
  productUpsert,
  collectionUpsert,
  pageUpsert,
  themeStageEdit,
  shippingConfigure,
  storePublish,
  storeTransferOwnership,
  ...shopifyConfigurationTools,
];

export * from "./configuration.js";
