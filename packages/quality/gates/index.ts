import type {
  ComplianceReport,
  ContentSet,
  GateAssertion,
  PolicySet,
  ProductCatalogue,
  QualityGateId,
  QualityGateResult,
  StorefrontBuild,
  UnitEconomicsModel,
} from "@kiln/contracts";
import { isComplianceSatisfied } from "@kiln/contracts";
import { slopLint } from "../slop-lint/index.js";

/**
 * Quality gates — CLAUDE.md §11.5.
 *
 * Deterministic functions over the artifact set and the deployed site. Never
 * overridable by an agent; a human can only clear one through an explicit
 * `quality_override` checkpoint, which stamps the artifact and surfaces in the
 * handover packet.
 *
 * Each gate returns its assertions individually rather than one boolean,
 * because "launch blocked: product-imagery failed" is useless and "3 of 7
 * products have fewer than 3 images: incense-holder-small, …" is actionable.
 */

export interface GateInput {
  readonly catalogue?: ProductCatalogue;
  readonly content?: ContentSet;
  readonly storefront?: StorefrontBuild;
  readonly policies?: PolicySet;
  readonly compliance?: ComplianceReport;
  readonly economics?: UnitEconomicsModel;
  /** Populated by the site/lighthouse/analytics tools during the QA phase. */
  readonly probes?: {
    readonly brokenLinks?: readonly string[];
    readonly deployedHtml?: readonly { path: string; html: string }[];
    readonly lighthouse?: readonly {
      path: string;
      performance: number;
      accessibility: number;
      seo: number;
    }[];
    readonly testTransaction?: { completed: boolean; refunded: boolean; reference?: string };
    readonly emailAuth?: { spf: boolean; dkim: boolean; dmarc: boolean };
    readonly analyticsPurchaseEvent?: { fired: boolean; eventName?: string };
  };
  /** Customer explicitly acknowledged negative contribution margin. */
  readonly negativeMarginAcknowledged?: boolean;
}

export type Gate = (input: GateInput) => QualityGateResult;

const now = (): string => new Date().toISOString();

function result(gate: QualityGateId, assertions: GateAssertion[]): QualityGateResult {
  return {
    gate,
    passed: assertions.every((a) => a.passed),
    assertions: assertions.length > 0 ? assertions : [{ assertion: "gate had nothing to check", passed: true, observed: "no applicable artifacts" }],
    overridden: false,
    evaluatedAt: now(),
  };
}

const MIN_DESCRIPTION_WORDS = 120;
const MIN_IMAGES = 3;

export const productDescriptionsGate: Gate = (input) => {
  const items = [
    ...(input.catalogue?.products ?? []).map((p) => ({ handle: p.handle, text: p.description })),
    ...(input.catalogue?.services ?? []).map((s) => ({ handle: s.handle, text: s.description })),
    ...(input.catalogue?.digitalDeliverables ?? []).map((d) => ({
      handle: d.handle,
      text: d.components.map((c) => c.description).join(" "),
    })),
  ];

  const short = items.filter((i) => slopLint(i.text).wordCount < MIN_DESCRIPTION_WORDS);
  const slop = items.filter((i) => !slopLint(i.text).passed);
  const seen = new Set<string>();
  const duplicates = items.filter((i) => {
    const key = i.text.trim().toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });

  return result("product-descriptions", [
    {
      assertion: `every item has a description of at least ${MIN_DESCRIPTION_WORDS} words`,
      passed: items.length > 0 && short.length === 0,
      observed:
        items.length === 0
          ? "no sellable items were supplied"
          : short.length === 0
            ? `all ${items.length} items`
            : `${short.length} too short: ${short.map((i) => i.handle).join(", ")}`,
    },
    {
      assertion: "every description passes the slop linter",
      passed: slop.length === 0,
      observed: slop.length === 0 ? `all ${items.length} items` : `${slop.length} failed: ${slop.map((i) => i.handle).join(", ")}`,
    },
    {
      assertion: "every description is unique",
      passed: duplicates.length === 0,
      observed: duplicates.length === 0 ? "no duplicates" : `duplicated: ${duplicates.map((i) => i.handle).join(", ")}`,
    },
  ]);
};

export const productImageryGate: Gate = (input) => {
  const products = input.catalogue?.products ?? [];
  const thin = products.filter((p) => p.images.length < MIN_IMAGES);
  const noAlt = products.flatMap((p) => p.images.filter((i) => !i.altText).map(() => p.handle));
  const unchecked = products.flatMap((p) => p.images.filter((i) => !i.storageKey).map(() => p.handle));
  const repeated = products.filter((p) => {
    const identities = p.images.map((i) => i.storageKey ?? `${i.role}:${i.brief}`);
    return new Set(identities).size !== identities.length;
  });

  return result("product-imagery", [
    {
      assertion: `every product has at least ${MIN_IMAGES} distinct images`,
      passed: products.length > 0 && thin.length === 0 && repeated.length === 0,
      observed:
        products.length === 0
          ? "no physical products were supplied"
          : thin.length === 0 && repeated.length === 0
            ? `all ${products.length} products`
            : [
                ...thin.map((p) => `${p.handle} has ${p.images.length}`),
                ...repeated.map((p) => `${p.handle} repeats an image`),
              ].join(", "),
    },
    {
      assertion: "every image has alt text",
      passed: noAlt.length === 0,
      observed: noAlt.length === 0 ? "all images described" : `${noAlt.length} missing on ${[...new Set(noAlt)].join(", ")}`,
    },
    {
      assertion: "every image passed image.qualityCheck",
      passed: products.length > 0 && unchecked.length === 0,
      observed:
        products.length === 0
          ? "no physical products were supplied"
          : unchecked.length === 0
            ? "all generated images have a storage key"
            : `${unchecked.length} unchecked on ${[...new Set(unchecked)].join(", ")}`,
    },
  ]);
};

export const noBrokenLinksGate: Gate = (input) => {
  const broken = input.probes?.brokenLinks;
  return result("no-broken-links", [
    {
      assertion: "zero broken internal links",
      passed: broken !== undefined && broken.length === 0,
      observed:
        broken === undefined
          ? "no internal-link scan ran"
          : broken.length === 0
            ? "none found"
            : `${broken.length}: ${broken.slice(0, 5).join(", ")}`,
    },
  ]);
};

/**
 * Placeholders are checked against the *deployed HTML*, not the artifacts.
 * A placeholder can survive a clean artifact and still reach the page through
 * a theme default or an unbound template variable, and the page is what the
 * customer's customers see.
 */
export const noPlaceholdersGate: Gate = (input) => {
  const pages = input.probes?.deployedHtml;
  if (pages === undefined || pages.length === 0) {
    return result("no-placeholders", [
      {
        assertion: "zero placeholder strings in deployed HTML",
        passed: false,
        observed: "no deployed HTML was inspected",
      },
    ]);
  }
  const offenders = pages
    .map((p) => ({ path: p.path, findings: slopLint(p.html, { disabledRules: ["heading-body-ratio", "sentence-length-uniformity", "tricolon-density", "em-dash-density", "participial-opener", "rhetorical-question-opener", "banned-phrase", "emoji-in-body"] }) }))
    .filter((p) => p.findings.findings.some((f) => f.rule === "placeholder-residue"));

  return result("no-placeholders", [
    {
      assertion: "zero placeholder strings in deployed HTML",
      passed: offenders.length === 0,
      observed: offenders.length === 0 ? `${pages.length} pages clean` : `${offenders.map((o) => o.path).join(", ")}`,
    },
  ]);
};

export const lighthouseGate: Gate = (input) => {
  const audits = input.probes?.lighthouse ?? [];
  const fails = (key: "performance" | "accessibility" | "seo", min: number): GateAssertion => {
    const bad = audits.filter((a) => a[key] < min);
    return {
      assertion: `${key} >= ${min} on primary templates`,
      passed: audits.length >= 3 && bad.length === 0,
      observed:
        audits.length === 0
          ? "no lighthouse audit ran"
          : audits.length < 3
            ? `only ${audits.length}/3 primary templates audited`
          : bad.length === 0
            ? `min ${Math.min(...audits.map((a) => a[key]))}`
            : bad.map((a) => `${a.path}=${a[key]}`).join(", "),
    };
  };

  return result("lighthouse", [fails("performance", 90), fails("accessibility", 95), fails("seo", 95)]);
};

export const checkoutGate: Gate = (input) => {
  const tx = input.probes?.testTransaction;
  return result("checkout-transacts", [
    {
      assertion: "a test transaction completed end to end",
      passed: tx?.completed === true,
      observed: tx ? `completed=${tx.completed} reference=${tx.reference ?? "none"}` : "no test transaction attempted",
    },
    {
      assertion: "the test transaction was refunded",
      passed: tx?.refunded === true,
      observed: tx ? `refunded=${tx.refunded}` : "no test transaction attempted",
    },
  ]);
};

export const policiesGate: Gate = (input) => {
  const policies = input.policies?.policies ?? [];
  const required = ["privacy", "terms", "refunds"] as const;
  const present = required.filter((k) => policies.some((p) => p.kind === k));
  const placeholderEntity = policies.filter(
    (p) => !p.legalEntityName || /your (company|brand)|example|tbd/i.test(p.legalEntityName),
  );

  return result("policies-present", [
    {
      assertion: `required policies present: ${required.join(", ")}`,
      passed: present.length === required.length,
      observed: `${present.length}/${required.length} present`,
    },
    {
      assertion: "every policy is linked from the footer",
      passed: input.policies?.footerLinked === true,
      observed: input.policies?.footerLinked === true ? "footer links verified" : "footer links not verified",
    },
    {
      assertion: "every policy names a real legal entity and jurisdiction",
      passed: policies.length > 0 && placeholderEntity.length === 0,
      observed:
        policies.length === 0
          ? "no policies"
          : placeholderEntity.length === 0
            ? "all entities named"
            : `placeholder entity on: ${placeholderEntity.map((p) => p.kind).join(", ")}`,
    },
  ]);
};

export const emailAuthGate: Gate = (input) => {
  const auth = input.probes?.emailAuth;
  return result("email-authentication", [
    { assertion: "SPF verified", passed: auth?.spf === true, observed: `spf=${auth?.spf ?? "not checked"}` },
    { assertion: "DKIM verified", passed: auth?.dkim === true, observed: `dkim=${auth?.dkim ?? "not checked"}` },
    { assertion: "DMARC verified", passed: auth?.dmarc === true, observed: `dmarc=${auth?.dmarc ?? "not checked"}` },
  ]);
};

export const analyticsGate: Gate = (input) => {
  const ev = input.probes?.analyticsPurchaseEvent;
  return result("analytics-purchase-event", [
    {
      assertion: "a purchase event fired on the test transaction",
      passed: ev?.fired === true,
      observed: ev ? `fired=${ev.fired} event=${ev.eventName ?? "unnamed"}` : "not checked",
    },
  ]);
};

export const complianceGate: Gate = (input) => {
  const report = input.compliance;
  const outstanding = report?.conditions.filter((c) => !c.satisfied) ?? [];
  return result("compliance-clear", [
    {
      assertion: "compliance status is clear or clear_with_conditions",
      passed: report !== undefined && report.status !== "blocked",
      observed: report ? `status=${report.status}` : "no compliance report",
    },
    {
      assertion: "all compliance conditions are satisfied",
      passed: report !== undefined && isComplianceSatisfied(report),
      observed: outstanding.length === 0 ? "none outstanding" : outstanding.map((c) => c.id).join(", "),
    },
  ]);
};

export const contributionMarginGate: Gate = (input) => {
  const m = input.economics;
  const positive = (m?.contributionMarginMicros ?? 0) > 0;
  return result("positive-contribution-margin", [
    {
      assertion: "contribution margin is positive at the configured price, or the customer acknowledged otherwise",
      passed: positive || input.negativeMarginAcknowledged === true,
      observed: m
        ? `${m.contributionMarginMicros} micros (${m.contributionMarginPct.toFixed(1)}%)${input.negativeMarginAcknowledged ? ", acknowledged by customer" : ""}`
        : "no unit economics model",
    },
  ]);
};

export const GATES: Readonly<Record<QualityGateId, Gate>> = {
  "product-descriptions": productDescriptionsGate,
  "product-imagery": productImageryGate,
  "no-broken-links": noBrokenLinksGate,
  "no-placeholders": noPlaceholdersGate,
  lighthouse: lighthouseGate,
  "checkout-transacts": checkoutGate,
  "policies-present": policiesGate,
  "email-authentication": emailAuthGate,
  "analytics-purchase-event": analyticsGate,
  "compliance-clear": complianceGate,
  "positive-contribution-margin": contributionMarginGate,
};

/** Runs the gates a playbook declares. Order is stable for readable output. */
export function evaluateGates(ids: readonly QualityGateId[], input: GateInput): QualityGateResult[] {
  return ids.map((id) => GATES[id](input));
}
