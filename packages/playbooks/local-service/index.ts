import { briefText, slotValue, type Playbook } from "../types.js";

/**
 * Local services.
 *
 * Specialises for geography. The distinctive risk here is service-area pages:
 * the lazy version spins one page per town with the name swapped, which search
 * engines treat as doorway pages and which reads as spam to a human. The growth
 * phase is required to build them from genuinely different local intent.
 */
export const localService: Playbook = {
  id: "local-service",
  version: "1.0.0",
  archetype: "service",
  title: "Local service business",
  description:
    "Builds a bookable local service: service menu, booking flow, service-area pages, quote " +
    "routing, and a review-solicitation sequence.",

  applicability: (brief) => {
    const text = briefText(brief);
    const geography = slotValue<{ serviceRadiusKm?: number; locality?: string }>(brief, "geography");
    const fulfilment = slotValue<{ model: string }>(brief, "fulfilment")?.model;

    let score = brief.archetypeHint.archetype === "service" ? 0.6 : 0.1;
    if (fulfilment === "in-person") score += 0.3;
    if (geography?.serviceRadiusKm !== undefined || geography?.locality !== undefined) score += 0.2;
    if (/\b(repair|cleaning|mobile|on-?site|call-?out|appointment|booking|installation|grooming|tuition)\b/.test(text)) score += 0.2;
    if (/\b(ship|shipping|download|template|stock|packaging)\b/.test(text)) score -= 0.4;
    return Math.max(0, Math.min(1, score));
  },

  phases: [
    { key: "intake", title: "Understand the idea", agent: "interviewer", dependsOn: [], produces: ["venture_brief"], onFailure: "escalate" },
    { key: "validation", title: "Validate local demand", agent: "analyst", dependsOn: ["venture_brief"], produces: ["validation_report", "unit_economics"], onFailure: "escalate" },
    { key: "strategy", title: "Position the business", agent: "strategist", dependsOn: ["validation_report"], produces: ["strategy_memo"], onFailure: "retry" },
    { key: "identity", title: "Build the brand", agent: "brand-director", dependsOn: ["strategy_memo"], produces: ["brand_system"], onFailure: "retry" },
    { key: "offer", title: "Design the service menu", agent: "product-architect", dependsOn: ["strategy_memo", "brand_system"], produces: ["product_catalogue"], onFailure: "retry" },
    { key: "content", title: "Write everything", agent: "content-studio", dependsOn: ["brand_system", "product_catalogue"], produces: ["content_set"], onFailure: "retry" },
    { key: "compliance", title: "Clear compliance", agent: "compliance-officer", dependsOn: ["product_catalogue", "content_set"], produces: ["compliance_report", "policy_set"], onFailure: "abort" },
    { key: "build", title: "Build site and booking", agent: "storefront-engineer", dependsOn: ["brand_system", "product_catalogue", "content_set", "policy_set"], produces: ["storefront_build"], onFailure: "escalate" },
    { key: "growth", title: "Local search and lead routing", agent: "growth-engineer", dependsOn: ["strategy_memo", "storefront_build"], produces: ["growth_plan"], onFailure: "degrade" },
    { key: "qa", title: "Test the booking flow", agent: "storefront-engineer", dependsOn: ["storefront_build"], produces: ["quality_report"], onFailure: "escalate" },
    { key: "launch", title: "Go live", agent: "storefront-engineer", dependsOn: ["quality_report"], produces: [], onFailure: "escalate" },
    { key: "operate", title: "Run it", agent: "operator", dependsOn: [], produces: ["operating_digest"], onFailure: "degrade" },
  ],

  hardGates: [
    { key: "brand-direction", afterPhase: "identity", title: "Approve the brand direction", question: "Is this the name and look you want on a van and an invoice?", rationale: "Local brands live on physical things that are expensive to reprint." },
    { key: "offer-and-pricing", afterPhase: "offer", title: "Approve the service menu", question: "Are these the services, durations, and prices?", rationale: "Durations set how many jobs fit in a day, which sets what the business can earn." },
    { key: "publish", afterPhase: "qa", title: "Publish and open the calendar", question: "Ready to take real bookings?", rationale: "Once live, customers can book time you will have to honour." },
  ],

  requiredScopes: [
    "research:read", "identity:read", "design:generate", "booking:configure", "site:build",
    "site:deploy", "dns:write", "content:write", "comms:configure", "compliance:screen",
    "analytics:write", "run:artifacts", "run:checkpoints", "run:notify",
  ],
  requiredConnections: ["cal-com"],
  qualityGates: [
    "product-descriptions", "no-broken-links", "no-placeholders", "lighthouse",
    "policies-present", "email-authentication", "compliance-clear",
    "positive-contribution-margin",
  ],
  handoverManifest: ["domain", "dns-zone", "email-domain", "booking-account", "brand-assets", "git-repository"],
  estimatedCostMicros: 4_800_000,
  estimatedDurationMinutes: 140,
};
