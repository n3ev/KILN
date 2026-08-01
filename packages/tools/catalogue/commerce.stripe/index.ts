import { z } from "zod";
import { defineTool, type AnyTool } from "../../core/define.js";
import { fakeId, isoFor, seedFor, slugify } from "../_helpers.js";

/** Stripe: products, prices, payment links, and Connect for the digital archetype. */

const money = z.object({ micros: z.number().int(), currency: z.string().length(3) });

export const stripeProductUpsert = defineTool({
  id: "stripe.product.upsert",
  version: "1.0.0",
  title: "Create or update a Stripe product",
  description:
    "Creates a Stripe product, or updates it when one already carries the same lookup key. " +
    "A Stripe product holds no price — create prices separately with stripe.price.upsert, " +
    "because a product can carry several (one-off, subscription, currency variants). Use this " +
    "for digital and service archetypes; physical goods sold through Shopify do not need it.",
  scopes: ["payments:write"],
  sideEffect: "write",
  input: z.object({
    lookupKey: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    active: z.boolean().default(true),
  }),
  output: z.object({ productId: z.string(), lookupKey: z.string(), created: z.boolean() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("stripe.product.upsert live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    return { productId: fakeId(seedFor(ctx, "stripe.product", input.lookupKey), "prod"), lookupKey: input.lookupKey, created: true };
  },
});

export const stripePriceUpsert = defineTool({
  id: "stripe.price.upsert",
  version: "1.0.0",
  title: "Create a Stripe price",
  description:
    "Attaches a price to a Stripe product. Prices are IMMUTABLE in Stripe: changing an amount " +
    "creates a new price and deactivates the old one rather than editing it, which is why this " +
    "tool never claims to update. Amounts are micros and converted to the smallest currency " +
    "unit at the boundary. Set `recurring` only for subscriptions.",
  scopes: ["payments:write"],
  sideEffect: "write",
  input: z.object({
    productId: z.string().min(1),
    amount: money,
    recurring: z.object({ interval: z.enum(["day", "week", "month", "year"]), intervalCount: z.number().int().min(1).default(1) }).optional(),
    taxBehaviour: z.enum(["inclusive", "exclusive", "unspecified"]).default("exclusive"),
  }),
  output: z.object({ priceId: z.string(), amountMinorUnits: z.number().int(), currency: z.string() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("stripe.price.upsert live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    return {
      priceId: fakeId(seedFor(ctx, "stripe.price", input.productId), "price"),
      amountMinorUnits: Math.round(input.amount.micros / 10_000),
      currency: input.amount.currency,
    };
  },
});

export const stripePaymentLinkCreate = defineTool({
  id: "stripe.paymentLink.create",
  version: "1.0.0",
  title: "Create a payment link",
  description:
    "Creates a hosted checkout link that can be sold from anywhere without a storefront — the " +
    "fastest path to a first sale for a digital product. Configure `afterCompletion` to point " +
    "at the delivery mechanism (a signed download or members area), or the buyer pays and " +
    "receives nothing, which is the single most damaging launch bug in this archetype.",
  scopes: ["payments:write"],
  sideEffect: "write",
  input: z.object({
    priceId: z.string().min(1),
    quantityAdjustable: z.boolean().default(false),
    afterCompletionUrl: z.string().url().optional(),
    collectShippingAddress: z.boolean().default(false),
  }),
  output: z.object({ paymentLinkId: z.string(), url: z.string().url(), active: z.boolean() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("stripe.paymentLink.create live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "stripe.paymentLink", input.priceId);
    const id = fakeId(rng, "plink");
    return { paymentLinkId: id, url: `https://buy.stripe.com/test_${slugify(id)}`, active: true };
  },
});

export const stripeTaxSettingsConfigure = defineTool({
  id: "stripe.taxSettings.configure",
  version: "1.0.0",
  title: "Configure tax settings",
  description:
    "Sets automatic tax behaviour and registered jurisdictions. Enabling automatic tax without " +
    "actually being registered in a jurisdiction collects money you are not entitled to " +
    "collect, so the compliance checklist must confirm registration first. This tool does not " +
    "register anyone for tax anywhere; that is a customer action with professional advice.",
  scopes: ["payments:write"],
  sideEffect: "write",
  input: z.object({
    automaticTax: z.boolean().default(false),
    registrations: z.array(z.object({ country: z.string().length(2), state: z.string().optional() })).default([]),
    pricesIncludeTax: z.boolean().default(false),
  }),
  output: z.object({ automaticTax: z.boolean(), registrationCount: z.number().int() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("stripe.taxSettings.configure live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input) {
    return { automaticTax: input.automaticTax, registrationCount: input.registrations.length };
  },
});

export const stripeCheckoutSessionCreate = defineTool({
  id: "stripe.checkoutSession.create",
  version: "1.0.0",
  title: "Create a checkout session",
  description:
    "Creates a one-time hosted checkout session, used by the QA phase to place and then refund " +
    "a real test transaction end to end. Sessions expire, so create one at the moment of use " +
    "rather than ahead of time. In sandbox mode this returns a simulated session that the " +
    "quality gate treats as a successful test transaction.",
  scopes: ["payments:write"],
  sideEffect: "write",
  input: z.object({
    priceId: z.string().min(1),
    quantity: z.number().int().min(1).default(1),
    successUrl: z.string().url(),
    cancelUrl: z.string().url(),
    testMode: z.boolean().default(true),
  }),
  output: z.object({ sessionId: z.string(), url: z.string().url(), expiresAt: z.string() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("stripe.checkoutSession.create live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "stripe.checkout", input.priceId);
    const id = fakeId(rng, "cs");
    return {
      sessionId: id,
      url: `https://checkout.stripe.com/c/pay/${slugify(id)}`,
      expiresAt: isoFor(ctx, `stripe.checkout:${input.priceId}`, 1),
    };
  },
});

export const stripeConnectAccountCreate = defineTool({
  id: "stripe.connectAccount.create",
  version: "1.0.0",
  title: "Create a Connect account",
  description:
    "Creates a Stripe Connect account so payouts land in the customer's own bank account " +
    "rather than KILN's. Requires the customer to complete identity and bank verification " +
    "themselves — KILN cannot do KYC on their behalf and must never ask for those details " +
    "directly. Returns an onboarding link to send them.",
  scopes: ["payments:write"],
  sideEffect: "write",
  input: z.object({
    country: z.string().length(2),
    email: z.string().email(),
    businessType: z.enum(["individual", "company"]).default("individual"),
  }),
  output: z.object({ accountId: z.string(), onboardingUrl: z.string().url(), chargesEnabled: z.boolean() }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("stripe.connectAccount.create live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "stripe.connect", input.email);
    const id = fakeId(rng, "acct");
    return { accountId: id, onboardingUrl: `https://connect.stripe.com/setup/${slugify(id)}`, chargesEnabled: false };
  },
});

export const stripeTools: readonly AnyTool[] = [
  stripeProductUpsert,
  stripePriceUpsert,
  stripePaymentLinkCreate,
  stripeCheckoutSessionCreate,
  stripeTaxSettingsConfigure,
  stripeConnectAccountCreate,
];
