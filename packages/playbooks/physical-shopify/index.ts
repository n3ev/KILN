import { briefText, slotValue, type Playbook } from "../types.js";

/**
 * Physical goods sold through Shopify.
 *
 * Distinctives: real supplier quotes, a landed-cost model, and the
 * MOQ-versus-print-on-demand trade-off routed through a hard gate, because it
 * determines how much of the customer's capital is at risk before the first
 * sale. That is not a decision an agent gets to make quietly.
 */
export const physicalShopify: Playbook = {
  id: "physical-shopify",
  version: "1.0.0",
  archetype: "physical",
  title: "Physical product on Shopify",
  description:
    "Sources a physical product, builds a Shopify storefront around it, and launches with " +
    "shipping profiles, policies, and a verified test transaction.",

  applicability: (brief) => {
    const text = briefText(brief);
    const fulfilment = slotValue<{ model: string }>(brief, "fulfilment")?.model;

    let score = brief.archetypeHint.archetype === "physical" ? 0.6 : 0.1;
    if (fulfilment && ["print-on-demand", "wholesale-stock", "made-to-order"].includes(fulfilment)) score += 0.3;
    if (/\b(sell|ship|product|handmade|made|goods|stock|packaging|material)\b/.test(text)) score += 0.15;
    if (/\b(download|template|course|ebook|software|saas)\b/.test(text)) score -= 0.4;
    if (/\b(repair|service|appointment|booking|on-site|mobile|call-?out)\b/.test(text)) score -= 0.4;
    return Math.max(0, Math.min(1, score));
  },

  phases: [
    { key: "intake", title: "Understand the idea", agent: "interviewer", dependsOn: [], produces: ["venture_brief"], onFailure: "escalate" },
    { key: "validation", title: "Validate demand", agent: "analyst", dependsOn: ["venture_brief"], produces: ["validation_report", "unit_economics"], onFailure: "escalate" },
    { key: "strategy", title: "Position the business", agent: "strategist", dependsOn: ["validation_report"], produces: ["strategy_memo"], onFailure: "retry" },
    { key: "identity", title: "Build the brand", agent: "brand-director", dependsOn: ["strategy_memo"], produces: ["brand_system"], onFailure: "retry" },
    { key: "offer", title: "Design the catalogue", agent: "product-architect", dependsOn: ["strategy_memo", "brand_system"], produces: ["product_catalogue"], onFailure: "retry" },
    { key: "sourcing", title: "Source and cost it", agent: "supply-officer", dependsOn: ["product_catalogue"], produces: ["supply_plan", "fulfilment_tradeoff"], onFailure: "escalate" },
    { key: "content", title: "Write everything", agent: "content-studio", dependsOn: ["brand_system", "product_catalogue"], produces: ["content_set"], onFailure: "retry" },
    { key: "compliance", title: "Clear compliance", agent: "compliance-officer", dependsOn: ["product_catalogue", "content_set"], produces: ["compliance_report", "policy_set"], onFailure: "abort" },
    { key: "build", title: "Build the storefront", agent: "storefront-engineer", dependsOn: ["brand_system", "product_catalogue", "supply_plan", "content_set", "policy_set"], produces: ["storefront_build"], onFailure: "escalate" },
    { key: "growth", title: "Plan the launch", agent: "growth-engineer", dependsOn: ["strategy_memo", "storefront_build"], produces: ["growth_plan"], onFailure: "degrade" },
    { key: "qa", title: "Test everything", agent: "storefront-engineer", dependsOn: ["storefront_build"], produces: ["quality_report"], onFailure: "escalate" },
    { key: "launch", title: "Go live", agent: "storefront-engineer", dependsOn: ["quality_report"], produces: [], onFailure: "escalate" },
    { key: "operate", title: "Run it", agent: "operator", dependsOn: [], produces: ["operating_digest"], onFailure: "degrade" },
  ],

  hardGates: [
    {
      key: "brand-direction",
      afterPhase: "identity",
      title: "Approve the brand direction",
      question: "Is this the name, look, and voice you want to trade under?",
      rationale: "Changing a brand after launch means reprinting packaging and losing search history.",
    },
    {
      key: "offer-and-pricing",
      afterPhase: "offer",
      title: "Approve the offer and pricing",
      question: "Are these the products, at these prices?",
      rationale: "Price sets the margin, the positioning, and which customers you attract.",
    },
    {
      key: "fulfilment-tradeoff",
      afterPhase: "sourcing",
      title: "Choose how it gets made",
      question: "Print-on-demand with thin margins, or a batch order with capital at risk?",
      rationale: "This decides how much of your money is committed before the first sale.",
    },
    {
      key: "publish",
      afterPhase: "qa",
      title: "Publish the store",
      question: "Ready to make this publicly shoppable?",
      rationale: "Once live, the store is visible and can take real orders and real money.",
    },
  ],

  requiredScopes: [
    "research:read", "identity:read", "design:generate", "commerce:write", "commerce:publish",
    "supply:read", "content:write", "compliance:screen", "analytics:write", "payments:write",
    "run:artifacts", "run:checkpoints", "run:notify",
  ],
  requiredConnections: ["shopify"],
  qualityGates: [
    "product-descriptions", "product-imagery", "no-broken-links", "no-placeholders",
    "lighthouse", "checkout-transacts", "policies-present", "email-authentication", "analytics-purchase-event",
    "compliance-clear", "positive-contribution-margin",
  ],
  handoverManifest: ["shopify-store", "domain", "stripe-account", "email-domain", "brand-assets", "git-repository"],
  estimatedCostMicros: 6_500_000,
  estimatedDurationMinutes: 180,
};
