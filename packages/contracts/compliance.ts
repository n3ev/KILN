import { z } from "zod";
import { CountryCode, Timestamp } from "./primitives.js";
import { SourceRef } from "./sources.js";

/**
 * Compliance Officer output. This agent can hard-block a run, so its schema is
 * built to make blocking unambiguous: a `blocked` status carries findings that
 * name the category and the jurisdiction, and no downstream phase may proceed
 * on a `blocked` report without an explicit human override checkpoint.
 */

export const ComplianceStatus = z.enum(["clear", "clear_with_conditions", "blocked"]);
export type ComplianceStatus = z.infer<typeof ComplianceStatus>;

export const RestrictedCategory = z.object({
  category: z.string().min(1),
  severity: z.enum(["prohibited", "restricted", "age-gated", "licence-required", "permitted"]),
  jurisdictions: z.array(CountryCode).min(1),
  detail: z.string().min(1),
  sources: z.array(SourceRef).min(1),
});

export const CategoryScreenResult = z.object({
  status: ComplianceStatus,
  findings: z.array(RestrictedCategory.omit({ sources: true })).min(1),
  ageGateRequired: z.boolean(),
});
export type CategoryScreenResult = z.infer<typeof CategoryScreenResult>;

export const ClaimReview = z.object({
  claim: z.string().min(1),
  /** Where it appears, so content can be corrected in place. */
  location: z.string().min(1),
  claimType: z.enum(["health", "financial", "environmental", "performance", "comparative", "origin"]),
  verdict: z.enum(["permitted", "needs-substantiation", "needs-qualifier", "prohibited"]),
  reasoning: z.string().min(1),
  /** Exact replacement wording when the verdict is not `permitted`. */
  suggestedRewrite: z.string().optional(),
  sources: z.array(SourceRef).default([]),
});

export const ChecklistItem = z.object({
  requirement: z.string().min(1),
  jurisdiction: CountryCode,
  applies: z.boolean(),
  status: z.enum(["satisfied", "outstanding", "not-applicable", "customer-action"]),
  /** Who has to do it. KILN cannot register a company for someone. */
  owner: z.enum(["kiln", "customer", "professional-advisor"]),
  detail: z.string().min(1),
  sources: z.array(SourceRef).default([]),
});

export const ComplianceCondition = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  /** Checked deterministically at the pre-launch gate. */
  satisfiedBy: z.string().min(1),
  satisfied: z.boolean().default(false),
});

export const ComplianceReport = z.object({
  status: ComplianceStatus,
  categories: z.array(RestrictedCategory).min(1),
  claims: z.array(ClaimReview).default([]),
  checklist: z.array(ChecklistItem).min(1),
  conditions: z.array(ComplianceCondition).default([]),
  /** Populated when status is `blocked`. Required. */
  blockingFindings: z.array(z.string().min(1)).default([]),
  ageGateRequired: z.boolean().default(false),
  /** Always advisory. KILN does not give legal advice and says so here. */
  disclaimer: z.string().min(1),
  generatedAt: Timestamp,
}).superRefine((report, ctx) => {
  const prohibited = report.categories.some((category) => category.severity === "prohibited");
  if (report.status === "blocked" && report.blockingFindings.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a blocked report must list its blocking findings", path: ["blockingFindings"] });
  }
  if (prohibited && report.status !== "blocked") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a prohibited category must hard-block the report", path: ["status"] });
  }
  if (prohibited && report.blockingFindings.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "prohibited categories require blocking findings", path: ["blockingFindings"] });
  }
});
export type ComplianceReport = z.infer<typeof ComplianceReport>;

export const PolicyKind = z.enum([
  "privacy",
  "terms",
  "refunds",
  "shipping",
  "cookies",
  "acceptable-use",
  "licence",
  "accessibility",
]);

export const Policy = z.object({
  kind: PolicyKind,
  title: z.string().min(1),
  /** Markdown. Rendered to a real page and included in the handover packet. */
  body: z.string().min(1),
  path: z.string().startsWith("/"),
  /** The pre-launch gate asserts these are correct and non-placeholder. */
  legalEntityName: z.string().min(1),
  jurisdiction: CountryCode,
  contactEmail: z.string().email(),
  lastUpdated: Timestamp,
});
export type Policy = z.infer<typeof Policy>;

export const PolicySet = z.object({
  policies: z.array(Policy).min(1),
  /** Footer must link every one of these — checked before launch. */
  footerLinked: z.boolean().default(false),
  generatedAt: Timestamp,
});
export type PolicySet = z.infer<typeof PolicySet>;

export function isComplianceSatisfied(r: ComplianceReport): boolean {
  if (r.status === "blocked") return false;
  if (r.status === "clear") return true;
  return r.conditions.every((c) => c.satisfied);
}
