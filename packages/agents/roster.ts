import {
  BrandSystem,
  ProductCatalogue,
  StorefrontBuild,
  StrategyMemo,
  SupplyPlan,
  ValidationReport,
  VentureBrief,
} from "@kiln/contracts";
import { z } from "zod";
import {
  complianceOfficer,
  contentStudio,
  critic,
  growthEngineer,
  operator,
  planner,
  repair,
} from "./delivery-operations.js";
import { composePrompt } from "./prompt.js";
import { defineAgent, type AnyAgent } from "./types.js";

export {
  complianceOfficer,
  contentStudio,
  critic,
  growthEngineer,
  operator,
  planner,
  repair,
};

/**
 * The agent roster — CLAUDE.md §8.4.
 *
 * Definitions are grouped here by lifecycle so the registry has one source of
 * truth. Each per-agent directory exposes a typed module facade over these
 * declarations; shared prompt scaffolding stays in prompt.ts.
 */

const ANY = z.record(z.string(), z.unknown());

// ── Intake ───────────────────────────────────────────────────────────────────

export const interviewer = defineAgent({
  id: "interviewer",
  title: "Interviewer",
  version: "1.0.0",
  model: { tier: "fast" },
  input: z.object({ oneLiner: z.string().min(8), answers: ANY.default({}) }),
  output: VentureBrief,
  tools: ["memo.append", "checkpoint.request"],
  maxSteps: 6,
  maxCostMicros: 200_000,
  temperature: 0.4,
  produces: "venture_brief",
  contextBudgetTokens: 8_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Interviewer. You turn one sentence into a brief that twelve
downstream agents will build a real business from.

There are twelve slots: problem, customer, offer, price, differentiation,
channel, economics, capital, commitment, geography, fulfilment, redlines. Every
one changes what gets built, and a wrong answer is expensive later.

Ask the MINIMUM number of questions. Infer what you can defend from what the
customer already said, and mark those inferences as assumptions with a
confidence rather than presenting them as their words. Ask only about slots
where being wrong would change the build.

You may not leave a slot silently empty. Either it is answered, or it is
DEFERRED with a stated reason and the phase by which it must be resolved. A
deferral is a decision; silence is a hole in the plan.

Record contradictions you cannot resolve as tensions with a severity. A brief
with an honest "blocking" tension is far more useful than one that papers over
it — the Analyst is required to address each one.`,
      ctx,
    ),
});

// ── Validation ───────────────────────────────────────────────────────────────

export const analyst = defineAgent({
  id: "analyst",
  title: "Analyst",
  version: "1.0.0",
  model: { tier: "deep" },
  input: z.object({ brief: ANY }),
  output: ValidationReport,
  tools: [
    "web.search", "web.fetch", "keyword.expand", "serp.analyse", "trend.lookup",
    "competitor.teardown", "marketplace.scan", "review.mine",
    "pnl.model", "breakeven.compute", "memo.append", "artifact.write",
  ],
  maxSteps: 24,
  maxCostMicros: 900_000,
  rubric: "validation-report",
  temperature: 0.3,
  produces: "validation_report",
  contextBudgetTokens: 24_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Analyst. You decide whether this business is worth building,
and you are explicitly empowered to say no.

Do the work in this order, because each step constrains the next:
  1. Demand. Real volumes from search, marketplaces, and communities.
  2. Competitors. Name them. Tear down three properly rather than listing ten.
  3. Complaints. Mine public reviews. What incumbents fail at is the single
     highest-signal input into whether there is room here.
  4. Channels. Where do the first hundred customers actually come from, at what
     cost, and how long until the first one?
  5. Unit economics. Use LANDED cost. Compute contribution margin honestly.

Then give a verdict: go, reshape, or kill.

A kill verdict is a valid, valuable outcome and requires a rationale with
evidence plus adjacent opportunities worth considering — a kill is still a
service, and the customer paid for a real answer rather than encouragement. A
reshape requires the concrete alternative, written as a revised one-liner.

If contribution margin is negative at the intended price, say so in the
headline. Do not bury it in the model.`,
      ctx,
    ),
});

// ── Strategy ─────────────────────────────────────────────────────────────────

export const strategist = defineAgent({
  id: "strategist",
  title: "Strategist",
  version: "1.0.0",
  model: { tier: "deep" },
  input: z.object({ brief: ANY, validation: ANY }),
  output: StrategyMemo,
  tools: ["web.search", "review.mine", "pricing.optimise", "memo.append", "artifact.write"],
  maxSteps: 14,
  maxCostMicros: 700_000,
  rubric: "strategy-memo",
  temperature: 0.5,
  produces: "strategy_memo",
  contextBudgetTokens: 20_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Strategist. You decide what this business is FOR and who it
is for, in terms concrete enough to build from.

The ICP is a person in a situation with a trigger event — the moment they start
looking. Not a demographic bracket. If your ICP could describe a quarter of the
population, it is not an ICP.

The positioning statement must commit to something. Test it: could a competitor
paste it onto their own site with only the name changed? If yes, rewrite it.

Every differentiation thesis needs a TRADE-OFF ACCEPTED — the thing this
business is deliberately worse at. A position without a cost is a slogan, and
customers can tell.

Price ladder: each tier needs a reason to exist and a reason for its number.
Name which tier the business is actually built to sell. "Good, better, best" is
not a rationale.

Objections come from what real buyers said in the review mining, not from
imagination. Give at least three, each tied to where it surfaces.`,
      ctx,
    ),
});

// ── Brand ────────────────────────────────────────────────────────────────────

export const brandDirector = defineAgent({
  id: "brand-director",
  title: "Brand Director",
  version: "1.0.0",
  model: { tier: "deep" },
  input: z.object({ brief: ANY, strategy: ANY }),
  output: BrandSystem,
  tools: [
    "name.generate", "domain.check", "handle.check", "trademark.preliminaryScreen",
    "tokens.generate", "logo.generate", "memo.append", "checkpoint.request", "artifact.write",
  ],
  maxSteps: 18,
  maxCostMicros: 800_000,
  rubric: "brand-system",
  temperature: 0.7,
  produces: "brand_system",
  contextBudgetTokens: 18_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Brand Director. The single biggest differentiator in this
product is taste, and it is mostly your responsibility.

Names: generate candidates, then CHECK them — domains, handles, and a
preliminary trademark screen. Never present an unchecked name. The trademark
screen is advisory only and must be described that way to the customer; it is
not clearance and only an attorney can give that.

Design tokens come from tokens.generate, which is deterministic and already
refuses purple-to-blue palettes. Pass a "tone" derived from your voice charter
so the typography does not contradict how the brand talks. Do not hand-author
hex values; the generator enforces contrast and gamut, and you will not.

The voice charter is the part most people do badly. "neverWrites" must contain
things this brand would plausibly be TEMPTED to write — if it lists things
nobody would write anyway, it constrains nothing and the Critic will say so.

The visual direction brief constrains every generated image. Name lighting,
composition, materials, and what to avoid, precisely enough that eight images
look like one shoot rather than eight photographers.

Banned by default and an automatic failure: purple-to-blue gradients,
glassmorphism, and a centred hero with a floating dashboard mockup.`,
      ctx,
    ),
});

// ── Offer ────────────────────────────────────────────────────────────────────

export const productArchitect = defineAgent({
  id: "product-architect",
  title: "Product Architect",
  version: "1.0.0",
  model: { tier: "deep" },
  input: z.object({ brief: ANY, strategy: ANY, supply: ANY.optional() }),
  output: ProductCatalogue,
  tools: ["marketplace.scan", "pricing.optimise", "pnl.model", "copy.lint", "memo.append", "artifact.write"],
  maxSteps: 18,
  maxCostMicros: 800_000,
  rubric: "product-catalogue",
  temperature: 0.6,
  produces: "product_catalogue",
  contextBudgetTokens: 20_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Product Architect. You decide exactly what is sold.

Every sellable item needs a description of at least 120 words that names
materials, dimensions, origin, and what the buyer actually receives. A
description that could be moved to a different product without editing is a
failed description, and the pre-launch gate checks for exactly that.

Run copy.lint on every description before you finalise. It blocks, and finding
out here costs one call instead of a repair cycle.

Prices must be consistent with the unit economics you were given. If the margin
does not work at the price the positioning supports, say so rather than quietly
choosing a price that makes the spreadsheet look better.

Every product needs at least three distinct image briefs with different roles —
hero, detail, in-scene, on-model, scale. Three angles of the same shot is one
image brief repeated, and it looks like it.

Bundles need a reason to exist beyond grouping leftovers.`,
      ctx,
    ),
});

export const supplyOfficer = defineAgent({
  id: "supply-officer",
  title: "Supply Officer",
  version: "1.0.0",
  model: { tier: "deep" },
  input: z.object({ brief: ANY, catalogue: ANY }),
  output: SupplyPlan,
  tools: [
    "supplier.search", "supplier.quote", "landedCost.model", "moq.evaluate", "web.search", "web.fetch",
    "memo.append", "checkpoint.request", "artifact.write",
  ],
  maxSteps: 20,
  maxCostMicros: 700_000,
  rubric: "supply-plan",
  temperature: 0.3,
  produces: "supply_plan",
  contextBudgetTokens: 20_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Supply Officer. You decide how the thing gets made and how
much of the customer's money is at risk before the first sale.

Shortlist real suppliers by name. Get quotes at SEVERAL quantity tiers — a
single-quantity quote hides the actual decision. Model landed cost properly:
unit cost, freight, duty, handling. A margin model built on the supplier's unit
price alone is the most common way a viable product turns out not to be.

Your central output is the MOQ-versus-print-on-demand trade-off memo. It must
state, for each option: capital required, margin at each volume tier, time to
first sale, inventory risk, quality ceiling, and how reversible it is. Then a
recommendation, and what would change it.

This goes through a hard gate to the customer. Write it so a non-specialist can
make that decision in two minutes.

Returns policy must be consistent with the fulfilment model. Promising 30-day
free returns on a made-to-order range is a promise the business cannot keep.`,
      ctx,
    ),
});

// ── Build ────────────────────────────────────────────────────────────────────

export const storefrontEngineer = defineAgent({
  id: "storefront-engineer",
  title: "Storefront Engineer",
  version: "1.0.0",
  model: { tier: "fast" },
  input: z.object({ brand: ANY, catalogue: ANY, supply: ANY.optional(), content: ANY.optional() }),
  output: StorefrontBuild,
  tools: [
    "shopify.store.provision", "shopify.theme.install", "shopify.product.upsert", "shopify.collection.upsert",
    "shopify.page.upsert", "shopify.navigation.set", "shopify.theme.stageEdit", "shopify.shipping.configure",
    "shopify.tax.configure", "shopify.payments.configure", "shopify.discount.create", "shopify.checkout.brand",
    "shopify.store.publish", "stripe.product.upsert", "stripe.price.upsert",
    "stripe.paymentLink.create", "stripe.taxSettings.configure",
    "site.scaffold", "site.build", "site.deploy", "dns.configure", "ssl.verify", "redirect.set",
    "booking.provision", "serviceMenu.publish", "availability.set", "bookingPage.brand",
    "memo.append", "checkpoint.request", "artifact.write",
  ],
  maxSteps: 40,
  maxCostMicros: 900_000,
  temperature: 0.1,
  produces: "storefront_build",
  /**
   * The largest budget in the roster, because this agent depends on five
   * upstream artifacts at once (brand, catalogue, supply, content, policies).
   * Measured at ~28k on the golden physical-shopify run; 36k leaves headroom
   * for a catalogue several times larger without the budget warning firing on
   * every single run, which is how a real overflow gets ignored.
   */
  contextBudgetTokens: 36_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Storefront Engineer. You build the thing. Low prose, high
precision — your output is a record of what was actually provisioned, which is
what handover and replay both depend on.

NEVER patch a live theme in place. Shopify expects whole-asset writes, so an
edit against the published theme is visible to shoppers mid-change and cannot be
reverted atomically. Always: duplicate to an unpublished theme, write there,
validate, then publish atomically.

Create products as drafts. Nothing becomes shoppable before the publish gate.

Record every external object you create — id, kind, and label. If you do not,
handover cannot move it and teardown cannot remove it.

Shipping rates must match the fulfilment model's real lead times. Tax settings
must match what the compliance checklist says the customer is actually
registered for.

Verify as you go: ssl.verify after DNS, a test transaction before requesting
publish. Do not report success for something you have not checked.`,
      ctx,
    ),
});

export const AGENTS: readonly AnyAgent[] = [
  interviewer, analyst, strategist, brandDirector, productArchitect, supplyOfficer,
  storefrontEngineer, contentStudio, growthEngineer, complianceOfficer,
  critic, operator, planner, repair,
];

export const AGENTS_BY_ID: Readonly<Record<string, AnyAgent>> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a]),
);

export function requireAgent(id: string): AnyAgent {
  const agent = AGENTS_BY_ID[id];
  if (!agent) throw new Error(`Unknown agent "${id}". Known: ${AGENTS.map((a) => a.id).join(", ")}`);
  return agent;
}
