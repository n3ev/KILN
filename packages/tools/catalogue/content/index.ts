import { z } from "zod";
import { defineTool, type AnyTool } from "../../core/define.js";
import { isoFor, seedFor, slugify } from "../_helpers.js";
import { slopLint, formatForRewrite } from "@kiln/quality";

/** Copy production, the slop linter as a tool, and structured-data emitters. */

export const copyDraft = defineTool({
  id: "copy.draft",
  version: "1.0.0",
  title: "Draft customer-facing copy",
  description:
    "Drafts one bounded piece of customer-facing copy from a concrete brief and voice constraints. It does not write an artifact or publish anything; the result must pass copy.lint before either action.",
  scopes: ["content:write"],
  sideEffect: "none",
  input: z.object({
    kind: z.enum(["headline", "body", "product-description", "email", "social-post", "faq-answer"]),
    brief: z.string().min(10),
    facts: z.array(z.string().min(1)).min(1),
    voiceWrites: z.array(z.string()).default([]),
    voiceNeverWrites: z.array(z.string()).default([]),
    maxWords: z.number().int().min(20).max(800).default(220),
  }),
  output: z.object({ draft: z.string().min(1), assumptionMarkers: z.array(z.string()), wordCount: z.number().int() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("copy.draft live model-backed path is owned by Content Studio; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "copy.draft", input.kind, input.brief);
    const fact = input.facts[0] ?? "The specification is recorded in the product brief.";
    const second = input.facts[1] ?? "The first batch is deliberately small.";
    const sentences = [
      input.brief.replace(/[.!?]+$/, "") + ".",
      fact.replace(/[.!?]+$/, "") + ".",
      `The practical detail is simple: ${second.replace(/[.!?]+$/, "").toLowerCase()}.`,
      rng.pick([
        "You can see the dimensions before ordering, and the parcel includes care instructions.",
        "The price reflects the stated material and the time used to finish each unit.",
        "Orders leave in the dispatch window shown on the page, with tracking where the carrier supports it.",
      ]),
    ];
    const draft = sentences.join(" ").split(/\s+/).slice(0, input.maxWords).join(" ");
    return { draft, assumptionMarkers: [], wordCount: draft.split(/\s+/).filter(Boolean).length };
  },
});

export const copyLint = defineTool({
  id: "copy.lint",
  version: "1.0.0",
  title: "Lint copy for slop",
  description:
    "Runs KILN's deterministic slop linter over a piece of customer-facing copy and returns " +
    "the exact offending spans with rewrite instructions. Call this on every draft BEFORE " +
    "writing it as an artifact \u2014 the artifact write will reject failing copy anyway, and " +
    "finding out here costs one call instead of a whole repair cycle. `passed: false` means " +
    "rewrite the whole piece, not delete the flagged words: the phrasing around them is " +
    "usually the real problem. Pass the brand's voice charter so its own banned words and its " +
    "emoji policy are enforced too.",
  scopes: ["content:write"],
  sideEffect: "none",
  input: z.object({
    text: z.string().min(1),
    emojiAllowed: z.boolean().default(false),
    extraBanned: z.array(z.string()).default([]),
    cycle: z.number().int().min(0).max(3).default(0),
  }),
  output: z.object({
    passed: z.boolean(),
    wordCount: z.number().int(),
    findings: z.array(z.object({
      rule: z.string(),
      severity: z.string(),
      message: z.string(),
      excerpt: z.string(),
      rewriteInstruction: z.string(),
      start: z.number().int(),
      end: z.number().int(),
    })),
    rewriteBrief: z.string(),
  }),
  idempotent: true,
  timeoutMs: 10_000,
  execute: runLint,
  simulate: runLint,
});

async function runLint(input: { text: string; emojiAllowed: boolean; extraBanned: string[]; cycle: number }) {
  const result = slopLint(input.text, {
    emojiAllowed: input.emojiAllowed,
    extraBanned: input.extraBanned,
    cycle: input.cycle,
  });
  return {
    passed: result.passed,
    wordCount: result.wordCount,
    findings: result.findings.map((f) => ({
      rule: f.rule,
      severity: f.severity,
      message: f.message,
      excerpt: f.excerpt,
      rewriteInstruction: f.rewriteInstruction,
      start: f.span.start,
      end: f.span.end,
    })),
    rewriteBrief: formatForRewrite(input.text, result),
  };
}

export const policyGenerate = defineTool({
  id: "policy.generate",
  version: "1.0.0",
  title: "Generate a policy document",
  description:
    "Generates a policy page (privacy, terms, refunds, shipping, cookies) for a named legal " +
    "entity and jurisdiction. The entity name and jurisdiction are REQUIRED and must be real \u2014 " +
    "the pre-launch quality gate rejects placeholders, and a policy naming the wrong entity is " +
    "worse than no policy. Output is a template informed by common practice, NOT legal advice, " +
    "and the customer should have it reviewed before trading at volume.",
  scopes: ["content:write"],
  sideEffect: "none",
  input: z.object({
    kind: z.enum(["privacy", "terms", "refunds", "shipping", "cookies", "acceptable-use", "licence", "accessibility"]),
    legalEntityName: z.string().min(2),
    jurisdiction: z.string().length(2),
    contactEmail: z.string().email(),
    specifics: z.record(z.string(), z.string()).default({}),
  }),
  output: z.object({ kind: z.string(), title: z.string(), bodyMarkdown: z.string(), path: z.string(), lastUpdated: z.string() }),
  idempotent: true,
  timeoutMs: 30_000,
  execute: async (input) => buildPolicy(input, new Date().toISOString()),
  simulate: async (input, ctx) => buildPolicy(input, isoFor(ctx, `policy.generate:${input.kind}:${input.legalEntityName}`)),
});

async function buildPolicy(input: {
  kind: string; legalEntityName: string; jurisdiction: string; contactEmail: string; specifics: Record<string, string>;
}, generatedAt: string) {
  const titles: Record<string, string> = {
    privacy: "Privacy policy", terms: "Terms of sale", refunds: "Returns and refunds",
    shipping: "Shipping", cookies: "Cookies", "acceptable-use": "Acceptable use",
    licence: "Licence", accessibility: "Accessibility",
  };
  const title = titles[input.kind] ?? input.kind;
  const extras = Object.entries(input.specifics).map(([k, v]) => `- **${k}**: ${v}`).join("\n");

  const body = [
    `# ${title}`,
    "",
    `This policy applies to purchases from ${input.legalEntityName}, operating from ` +
      `${input.jurisdiction}. Questions go to ${input.contactEmail}, and we answer within ` +
      "two working days.",
    "",
    "## What this covers",
    "",
    `Everything sold through this site. Where a specific product carries different terms, ` +
      "those are stated on the product page and take precedence over this document.",
    extras ? `\n## Specifics\n\n${extras}` : "",
    "",
    "## Changes",
    "",
    `We update this page when the practice behind it changes, and the date below moves with it.`,
    "",
    `_Last updated: ${generatedAt.slice(0, 10)}._`,
  ].join("\n");

  return {
    kind: input.kind,
    title,
    bodyMarkdown: body,
    path: `/policies/${slugify(input.kind)}`,
    lastUpdated: generatedAt,
  };
}

export const seoSchema = defineTool({
  id: "seo.schema",
  version: "1.0.0",
  title: "Emit JSON-LD structured data",
  description:
    "Produces schema.org JSON-LD for a page. Only emit types the page genuinely is: marking a " +
    "category page as a Product, or inventing review counts, is structured-data spam and risks " +
    "a manual penalty that is slow to lift. Fields must match what is visible on the page.",
  scopes: ["content:write"],
  sideEffect: "none",
  input: z.object({
    type: z.enum(["Organization", "Product", "LocalBusiness", "FAQPage", "BreadcrumbList", "Service"]),
    data: z.record(z.string(), z.unknown()),
  }),
  output: z.object({ jsonLd: z.string(), type: z.string() }),
  idempotent: true,
  timeoutMs: 10_000,
  execute: buildSchema,
  simulate: buildSchema,
});

async function buildSchema(input: { type: string; data: Record<string, unknown> }) {
  return {
    jsonLd: JSON.stringify({ "@context": "https://schema.org", "@type": input.type, ...input.data }, null, 2),
    type: input.type,
  };
}

export const faqDerive = defineTool({
  id: "faq.derive",
  version: "1.0.0",
  title: "Derive FAQs from real objections",
  description:
    "Turns the objection map and mined customer complaints into FAQ entries. Questions must be " +
    "ones buyers actually ask \u2014 'What makes you different?' is a question nobody types, whereas " +
    "'Does this fit a 3mm stick?' is. Each answer should remove a specific reason not to buy.",
  scopes: ["content:write"],
  sideEffect: "none",
  input: z.object({
    objections: z.array(z.string().min(1)).min(1),
    productContext: z.string().min(5),
    limit: z.number().int().min(1).max(20).default(6),
  }),
  output: z.object({ entries: z.array(z.object({ question: z.string(), answer: z.string() })) }),
  idempotent: true,
  timeoutMs: 15_000,
  async execute() {
    throw new Error("faq.derive is generated by the Content Studio agent; call it through the agent.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "faq.derive", input.productContext);
    return {
      entries: input.objections.slice(0, input.limit).map((objection) => ({
        question: objection.endsWith("?") ? objection : `${objection.replace(/\.$/, "")}?`,
        answer: `Yes, and here is the specific detail: ${rng.pick([
          "dispatch is within two working days and tracked",
          "the well takes a standard 3mm stick",
          "returns are 30 days, and we pay the postage",
          "each batch is fired twice, which is why the glaze pools",
        ])}.`,
      })),
    };
  },
});

export const sitemapGenerate = defineTool({
  id: "sitemap.generate",
  version: "1.0.0",
  title: "Generate a sitemap",
  description:
    "Produces sitemap.xml from a page list. Include only pages that should be indexed \u2014 " +
    "listing thin, duplicate, or noindex pages here actively harms crawl budget. Paths must be " +
    "absolute and already live.",
  scopes: ["content:write"],
  sideEffect: "none",
  input: z.object({
    baseUrl: z.string().url(),
    paths: z.array(z.object({ path: z.string(), changefreq: z.string().default("weekly"), priority: z.number().min(0).max(1).default(0.5) })).min(1),
  }),
  output: z.object({ xml: z.string(), urlCount: z.number().int() }),
  idempotent: true,
  timeoutMs: 10_000,
  execute: buildSitemap,
  simulate: buildSitemap,
});

async function buildSitemap(input: { baseUrl: string; paths: { path: string; changefreq: string; priority: number }[] }) {
  const urls = input.paths
    .map((p) => `  <url><loc>${input.baseUrl.replace(/\/$/, "")}${p.path}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`)
    .join("\n");
  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
    urlCount: input.paths.length,
  };
}

export const contentTools: readonly AnyTool[] = [copyDraft, copyLint, policyGenerate, seoSchema, faqDerive, sitemapGenerate];
