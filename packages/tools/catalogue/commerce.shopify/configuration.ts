import { z } from "zod";
import { defineTool, type AnyTool } from "../../core/define.js";
import { fakeId, seedFor } from "../_helpers.js";

/** Shopify configuration calls kept separate from catalogue CRUD. */

export const themeInstall = defineTool({
  id: "shopify.theme.install",
  version: "1.0.0",
  title: "Install a Shopify theme",
  description:
    "Installs a theme into an unpublished slot and returns its provider id. It never makes the theme live; use theme.stageEdit to write assets and store.publish for the approval-gated swap.",
  scopes: ["commerce:write"],
  sideEffect: "write",
  input: z.object({ storeId: z.string().min(1), source: z.enum(["shopify-library", "zip", "git"]), reference: z.string().min(1), name: z.string().min(1) }),
  output: z.object({ themeId: z.string(), name: z.string(), role: z.literal("unpublished"), installed: z.boolean() }),
  idempotent: true,
  timeoutMs: 120_000,
  async execute() {
    throw new Error("shopify.theme.install live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    return {
      themeId: fakeId(seedFor(ctx, "shopify.theme.install", input.storeId, input.reference), "theme"),
      name: input.name,
      role: "unpublished" as const,
      installed: true,
    };
  },
});

export const navigationSet = defineTool({
  id: "shopify.navigation.set",
  version: "1.0.0",
  title: "Set storefront navigation",
  description:
    "Replaces one Shopify menu with the complete ordered tree supplied. It validates local paths but does not create missing pages, so call page.upsert before linking a new destination.",
  scopes: ["commerce:write"],
  sideEffect: "write",
  input: z.object({
    handle: z.string().min(1),
    title: z.string().min(1),
    items: z.array(z.object({ label: z.string().min(1), path: z.string().min(1) })).min(1),
  }),
  output: z.object({ menuId: z.string(), handle: z.string(), itemCount: z.number().int() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("shopify.navigation.set live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    return {
      menuId: fakeId(seedFor(ctx, "shopify.navigation.set", input.handle), "menu"),
      handle: input.handle,
      itemCount: input.items.length,
    };
  },
});

export const taxConfigure = defineTool({
  id: "shopify.tax.configure",
  version: "1.0.0",
  title: "Configure Shopify tax",
  description:
    "Sets automatic or manual tax collection from the Compliance Officer's registration record. It does not register the merchant for tax and refuses to imply a registration that was not supplied.",
  scopes: ["commerce:write"],
  sideEffect: "write",
  input: z.object({ mode: z.enum(["automatic", "manual", "not-registered"]), pricesIncludeTax: z.boolean(), registrations: z.array(z.object({ country: z.string().length(2), registrationId: z.string().optional() })).default([]) }),
  output: z.object({ configured: z.boolean(), mode: z.string(), registrationCount: z.number().int() }),
  idempotent: true,
  timeoutMs: 45_000,
  async execute() {
    throw new Error("shopify.tax.configure live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input) {
    return { configured: true, mode: input.mode, registrationCount: input.registrations.length };
  },
});

export const paymentsConfigure = defineTool({
  id: "shopify.payments.configure",
  version: "1.0.0",
  title: "Configure Shopify payments",
  description:
    "Configures test-mode payment methods and records the merchant-of-record entity. It never completes KYC on a customer's behalf and cannot enable live payouts without the provider's verification.",
  scopes: ["commerce:write", "payments:write"],
  sideEffect: "write",
  input: z.object({ provider: z.enum(["shopify-payments", "manual"]), methods: z.array(z.string().min(1)).min(1), testMode: z.boolean().default(true), merchantOfRecord: z.enum(["customer", "platform", "provider"]) }),
  output: z.object({ configured: z.boolean(), provider: z.string(), methods: z.array(z.string()), testModeVerified: z.boolean() }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("shopify.payments.configure live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input) {
    return { configured: true, provider: input.provider, methods: input.methods, testModeVerified: input.testMode };
  },
});

export const discountCreate = defineTool({
  id: "shopify.discount.create",
  version: "1.0.0",
  title: "Create a discount",
  description:
    "Creates an explicit discount code with a bounded value and optional usage ceiling. It does not publish vague automatic promotions, and repeat calls with the same code are idempotent.",
  scopes: ["commerce:write"],
  sideEffect: "write",
  input: z.object({ code: z.string().min(2), kind: z.enum(["percentage", "fixed", "shipping"]), value: z.number().nonnegative(), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional(), usageLimit: z.number().int().positive().optional() }),
  output: z.object({ discountId: z.string(), code: z.string(), active: z.boolean() }),
  idempotent: true,
  idempotencyIgnore: ["startsAt"],
  timeoutMs: 30_000,
  async execute() {
    throw new Error("shopify.discount.create live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    return { discountId: fakeId(seedFor(ctx, "shopify.discount.create", input.code), "disc"), code: input.code, active: true };
  },
});

export const checkoutBrand = defineTool({
  id: "shopify.checkout.brand",
  version: "1.0.0",
  title: "Brand Shopify checkout",
  description:
    "Applies the approved logo, colour, and typography choices to checkout within Shopify's supported settings. It does not inject scripts or bypass checkout security restrictions.",
  scopes: ["commerce:write"],
  sideEffect: "write",
  input: z.object({ logoStorageKey: z.string().min(1), accentColour: z.string().min(4), backgroundColour: z.string().min(4), fontFamily: z.string().min(1) }),
  output: z.object({ applied: z.boolean(), checkoutProfileId: z.string() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("shopify.checkout.brand live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    return { applied: true, checkoutProfileId: fakeId(seedFor(ctx, "shopify.checkout.brand", input.logoStorageKey), "checkout") };
  },
});

export const shopifyConfigurationTools: readonly AnyTool[] = [
  themeInstall,
  navigationSet,
  taxConfigure,
  paymentsConfigure,
  discountCreate,
  checkoutBrand,
];
