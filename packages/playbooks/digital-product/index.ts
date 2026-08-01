import { briefText, slotValue, type Playbook } from "../types.js";

/**
 * Digital products.
 *
 * The archetype where KILN can produce the ENTIRE product rather than a wrapper
 * around one — the template pack, the lesson scripts, the tool itself. The
 * `build` phase is therefore a content phase, not a provisioning phase, and the
 * delivery mechanism matters more than the storefront: a buyer who pays and
 * receives nothing is the only truly unrecoverable launch bug here.
 */
export const digitalProduct: Playbook = {
  id: "digital-product",
  version: "1.0.0",
  archetype: "digital",
  title: "Digital product",
  description:
    "Produces the deliverable itself, sells it through Stripe with gated delivery, and builds " +
    "a lead magnet and nurture sequence around it.",

  applicability: (brief) => {
    const text = briefText(brief);
    const fulfilment = slotValue<{ model: string }>(brief, "fulfilment")?.model;

    let score = brief.archetypeHint.archetype === "digital" ? 0.6 : 0.1;
    if (fulfilment === "digital-download") score += 0.35;
    if (/\b(template|notion|course|ebook|guide|preset|software|saas|download|licence|license)\b/.test(text)) score += 0.25;
    if (/\b(ship|shipping|packaging|stock|material|handmade|warehouse)\b/.test(text)) score -= 0.4;
    if (/\b(repair|appointment|on-?site|call-?out|mobile)\b/.test(text)) score -= 0.4;
    return Math.max(0, Math.min(1, score));
  },

  phases: [
    { key: "intake", title: "Understand the idea", agent: "interviewer", dependsOn: [], produces: ["venture_brief"], onFailure: "escalate" },
    { key: "validation", title: "Validate demand", agent: "analyst", dependsOn: ["venture_brief"], produces: ["validation_report", "unit_economics"], onFailure: "escalate" },
    { key: "strategy", title: "Position the business", agent: "strategist", dependsOn: ["validation_report"], produces: ["strategy_memo"], onFailure: "retry" },
    { key: "identity", title: "Build the brand", agent: "brand-director", dependsOn: ["strategy_memo"], produces: ["brand_system"], onFailure: "retry" },
    { key: "offer", title: "Specify the deliverable", agent: "product-architect", dependsOn: ["strategy_memo", "brand_system"], produces: ["product_catalogue"], onFailure: "retry" },
    { key: "build", title: "Produce the deliverable", agent: "content-studio", dependsOn: ["product_catalogue"], produces: ["content_set"], onFailure: "retry" },
    { key: "compliance", title: "Clear compliance", agent: "compliance-officer", dependsOn: ["product_catalogue", "content_set"], produces: ["compliance_report", "policy_set"], onFailure: "abort" },
    { key: "infrastructure", title: "Set up checkout and delivery", agent: "storefront-engineer", dependsOn: ["brand_system", "product_catalogue", "content_set", "policy_set"], produces: ["storefront_build"], onFailure: "escalate" },
    { key: "growth", title: "Plan the launch", agent: "growth-engineer", dependsOn: ["strategy_memo", "storefront_build"], produces: ["growth_plan"], onFailure: "degrade" },
    { key: "qa", title: "Test purchase and delivery", agent: "storefront-engineer", dependsOn: ["storefront_build"], produces: ["quality_report"], onFailure: "escalate" },
    { key: "launch", title: "Go live", agent: "storefront-engineer", dependsOn: ["quality_report"], produces: [], onFailure: "escalate" },
    { key: "operate", title: "Run it", agent: "operator", dependsOn: [], produces: ["operating_digest"], onFailure: "degrade" },
  ],

  hardGates: [
    { key: "brand-direction", afterPhase: "identity", title: "Approve the brand direction", question: "Is this the name, look, and voice you want?", rationale: "The brand carries into every email and every file the buyer downloads." },
    { key: "offer-and-pricing", afterPhase: "offer", title: "Approve the offer and pricing", question: "Is this the deliverable, at this price?", rationale: "Digital pricing is positioning: it decides who buys and what they expect." },
    { key: "deliverable-review", afterPhase: "build", title: "Review the actual product", question: "Is this good enough to sell?", rationale: "KILN produced the deliverable itself. You should read it before anyone pays for it." },
    { key: "publish", afterPhase: "qa", title: "Publish", question: "Ready to take real payments?", rationale: "Once live, the checkout takes real money and delivery must work." },
  ],

  requiredScopes: [
    "research:read", "identity:read", "design:generate", "payments:write", "content:write",
    "site:build", "site:deploy", "comms:configure", "compliance:screen", "analytics:write",
    "run:artifacts", "run:checkpoints", "run:notify",
  ],
  requiredConnections: ["stripe"],
  qualityGates: [
    "product-descriptions", "no-broken-links", "no-placeholders", "lighthouse",
    "checkout-transacts", "policies-present", "email-authentication",
    "analytics-purchase-event", "compliance-clear", "positive-contribution-margin",
  ],
  handoverManifest: ["domain", "stripe-account", "email-domain", "brand-assets", "git-repository"],
  estimatedCostMicros: 5_200_000,
  estimatedDurationMinutes: 150,
};
