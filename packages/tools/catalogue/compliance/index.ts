import { CategoryScreenResult } from "@kiln/contracts";
import { z } from "zod";
import { defineTool, type AnyTool } from "../../core/define.js";
import { fakeId, seedFor, slugify, units } from "../_helpers.js";
import { RESTRICTED_CATEGORY_RULES } from "./restricted.js";

/** Restricted-category screening, claims review, and jurisdiction checklists. */

export const categoryScreen = defineTool({
  id: "category.screen",
  version: "1.0.0",
  title: "Screen for restricted categories",
  description:
    "Screens a product or service description against restricted and prohibited category " +
    "rules for the given jurisdictions. A `prohibited` result HARD-BLOCKS the run and cannot " +
    "be worked around by rewording the description \u2014 the category is the problem, not the copy. " +
    "`licence-required` and `age-gated` results become conditions the pre-launch gate checks. " +
    "This is a screen against common platform and jurisdictional rules, not legal advice.",
  scopes: ["compliance:screen"],
  sideEffect: "read",
  input: z.object({
    description: z.string().min(5),
    productTypes: z.array(z.string()).default([]),
    jurisdictions: z.array(z.string().length(2)).min(1),
  }),
  output: CategoryScreenResult,
  idempotent: true,
  timeoutMs: 15_000,
  execute: screenCategory,
  simulate: screenCategory,
});

export async function screenCategory(input: { description: string; productTypes: string[]; jurisdictions: string[] }) {
  const haystack = [input.description, ...input.productTypes].join(" ");
  const findings = RESTRICTED_CATEGORY_RULES.filter((rule) => rule.pattern.test(haystack)).map((r) => ({
    category: r.category,
    severity: r.severity,
    jurisdictions: input.jurisdictions,
    detail:
      r.severity === "prohibited"
        ? `Selling ${r.category} is prohibited on the payment and commerce platforms KILN provisions. This build cannot proceed on this category.`
        : r.severity === "licence-required"
          ? `Selling ${r.category} requires registration or a licence in at least one target jurisdiction. The customer must hold it before launch.`
          : r.severity === "age-gated"
            ? `${r.category} requires an age gate at entry and at checkout.`
            : `${r.category} carries labelling and claims restrictions that constrain the product copy.`,
  }));

  const blocked = findings.some((f) => f.severity === "prohibited");
  return {
    status: blocked ? ("blocked" as const) : findings.length > 0 ? ("clear_with_conditions" as const) : ("clear" as const),
    findings: findings.length > 0 ? findings : [{
      category: "general-merchandise",
      severity: "permitted" as const,
      jurisdictions: input.jurisdictions,
      detail: "No restricted-category match. Standard consumer-goods obligations apply.",
    }],
    ageGateRequired: findings.some((f) => f.severity === "age-gated"),
  };
}

export const claimsReview = defineTool({
  id: "claims.review",
  version: "1.0.0",
  title: "Review marketing claims",
  description:
    "Reviews copy for health, financial, environmental, and comparative claims that need " +
    "substantiation or a qualifier. Returns a verdict per claim with exact replacement wording " +
    "where one is needed. 'Chemical-free', 'clinically proven', and unqualified 'eco-friendly' " +
    "are the three that most often reach a live storefront and most often draw a complaint. " +
    "Advisory, not legal advice.",
  scopes: ["compliance:screen"],
  sideEffect: "read",
  input: z.object({ text: z.string().min(1), location: z.string().min(1), jurisdictions: z.array(z.string().length(2)).min(1) }),
  output: z.object({
    claims: z.array(z.object({
      claim: z.string(),
      claimType: z.enum(["health", "financial", "environmental", "performance", "comparative", "origin"]),
      verdict: z.enum(["permitted", "needs-substantiation", "needs-qualifier", "prohibited"]),
      reasoning: z.string(),
      suggestedRewrite: z.string().optional(),
    })),
  }),
  idempotent: true,
  timeoutMs: 20_000,
  execute: reviewClaims,
  simulate: reviewClaims,
});

async function reviewClaims(input: { text: string; location: string; jurisdictions: string[] }) {
  const rules: { re: RegExp; type: "health" | "environmental" | "performance" | "comparative" | "financial"; verdict: "needs-substantiation" | "needs-qualifier" | "prohibited"; why: string; fix: string }[] = [
    { re: /\bchemical[- ]free\b/i, type: "environmental", verdict: "prohibited", why: "Everything is made of chemicals; the claim is meaningless and challengeable.", fix: "Name what is actually absent, e.g. 'no added fragrance'." },
    { re: /\b(cures?|treats?|heals?|clinically proven)\b/i, type: "health", verdict: "prohibited", why: "Medicinal claims require authorisation this business does not hold.", fix: "Describe the experience, not a medical outcome." },
    { re: /\b(eco[- ]friendly|sustainable|green)\b/i, type: "environmental", verdict: "needs-qualifier", why: "Unqualified environmental claims must be specific and substantiated.", fix: "State the specific attribute and its basis, e.g. 'ships in unbleached cardboard'." },
    { re: /\b(100%|guaranteed|always|never fails)\b/i, type: "performance", verdict: "needs-substantiation", why: "Absolute performance claims need evidence on file.", fix: "Soften to what is measurable, or cite the test." },
    { re: /\b(best|cheapest|number one)\b/i, type: "comparative", verdict: "needs-substantiation", why: "Superlatives are comparative claims and need a substantiated basis.", fix: "Compare on a stated, verifiable dimension or drop it." },
    { re: /\b(returns? of|profit|guaranteed income)\b/i, type: "financial", verdict: "prohibited", why: "Financial return claims are regulated.", fix: "Remove entirely." },
  ];

  const claims = rules.filter((r) => r.re.test(input.text)).map((r) => ({
    claim: input.text.match(r.re)?.[0] ?? "",
    claimType: r.type,
    verdict: r.verdict,
    reasoning: r.why,
    suggestedRewrite: r.fix,
  }));
  return { claims };
}

export const jurisdictionChecklist = defineTool({
  id: "jurisdiction.checklist",
  version: "1.0.0",
  title: "Build a jurisdiction checklist",
  description:
    "Produces the obligations that attach to selling in the given jurisdictions: consumer " +
    "rights, distance-selling rules, tax registration thresholds, and data protection. Each " +
    "item names its owner \u2014 KILN, the customer, or a professional advisor \u2014 because several " +
    "of these genuinely cannot be automated and pretending otherwise is how customers end up " +
    "unregistered. Advisory, not legal advice.",
  scopes: ["compliance:screen"],
  sideEffect: "read",
  input: z.object({
    sellsTo: z.array(z.string().length(2)).min(1),
    operatesFrom: z.string().length(2),
    archetype: z.enum(["physical", "digital", "service"]),
  }),
  output: z.object({
    items: z.array(z.object({
      requirement: z.string(),
      jurisdiction: z.string(),
      applies: z.boolean(),
      status: z.enum(["satisfied", "outstanding", "not-applicable", "customer-action"]),
      owner: z.enum(["kiln", "customer", "professional-advisor"]),
      detail: z.string(),
    })),
  }),
  idempotent: true,
  timeoutMs: 20_000,
  execute: buildChecklist,
  simulate: buildChecklist,
});

async function buildChecklist(input: { sellsTo: string[]; operatesFrom: string; archetype: string }) {
  const items = [
    { requirement: "Publish a privacy notice naming the data controller", jurisdiction: input.operatesFrom, owner: "kiln" as const, status: "outstanding" as const, detail: "Generated by policy.generate and linked from the footer." },
    { requirement: "Publish terms of sale and a returns policy", jurisdiction: input.operatesFrom, owner: "kiln" as const, status: "outstanding" as const, detail: "Must match the actual fulfilment model and lead times." },
    { requirement: "Register the business entity", jurisdiction: input.operatesFrom, owner: "customer" as const, status: "customer-action" as const, detail: "KILN cannot incorporate on the customer's behalf." },
    { requirement: "Assess sales-tax or VAT registration thresholds", jurisdiction: input.operatesFrom, owner: "professional-advisor" as const, status: "outstanding" as const, detail: "Thresholds depend on turnover and destination; needs an accountant." },
    ...(input.archetype === "physical" ? [{ requirement: "Provide a 14-day cancellation right for distance sales", jurisdiction: input.sellsTo[0] ?? input.operatesFrom, owner: "kiln" as const, status: "outstanding" as const, detail: "Reflected in the returns policy and the checkout copy." }] : []),
    ...(input.archetype === "digital" ? [{ requirement: "State the waiver of cancellation rights on immediate digital delivery", jurisdiction: input.sellsTo[0] ?? input.operatesFrom, owner: "kiln" as const, status: "outstanding" as const, detail: "Required for the customer to lawfully deny refunds after download." }] : []),
    ...(input.archetype === "service" ? [{ requirement: "Confirm any trade licensing or insurance for on-site work", jurisdiction: input.operatesFrom, owner: "customer" as const, status: "customer-action" as const, detail: "Public liability cover is usually required before taking bookings." }] : []),
  ];
  return { items: items.map((i) => ({ ...i, applies: true })) };
}

export const ageGateConfigure = defineTool({
  id: "ageGate.configure",
  version: "1.0.0",
  title: "Configure an age gate",
  description:
    "Adds an age confirmation at site entry and at checkout for age-restricted categories. A " +
    "self-declared gate is the minimum common standard and is not identity verification; where " +
    "the jurisdiction demands verified age, this is not sufficient and the compliance report " +
    "should say so plainly.",
  scopes: ["compliance:screen", "site:build"],
  sideEffect: "write",
  input: z.object({ minimumAge: z.number().int().min(13).max(25), enforceAtCheckout: z.boolean().default(true), message: z.string().optional() }),
  output: z.object({ configured: z.boolean(), minimumAge: z.number().int(), verified: z.literal(false) }),
  idempotent: true,
  timeoutMs: 20_000,
  execute: configureAgeGate,
  simulate: configureAgeGate,
});

async function configureAgeGate(input: { minimumAge: number; enforceAtCheckout: boolean }) {
  return { configured: true, minimumAge: input.minimumAge, verified: false as const };
}

export const complianceTools: readonly AnyTool[] = [categoryScreen, claimsReview, jurisdictionChecklist, ageGateConfigure];
