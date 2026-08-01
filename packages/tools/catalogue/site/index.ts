import { z } from "zod";
import { defineTool, type AnyTool } from "../../core/define.js";
import { fakeId, isoIn, seedFor, units } from "../_helpers.js";

/** Site generation, deployment, DNS, and auditing for non-Shopify surfaces. */

export const siteScaffold = defineTool({
  id: "site.scaffold",
  version: "1.0.0",
  title: "Scaffold a site",
  description:
    "Generates a real Astro or Next.js project from the design token set and a chosen layout " +
    "archetype \u2014 actual files, not a description of files. The layout archetype must come from " +
    "the brand's token set; picking a different one here produces a site that contradicts its " +
    "own design system. Returns the file manifest so later tools can patch specific pages.",
  scopes: ["site:build"],
  sideEffect: "write",
  input: z.object({
    framework: z.enum(["astro", "next"]).default("astro"),
    layoutArchetype: z.string().min(1),
    cssVariables: z.record(z.string(), z.string()),
    pages: z.array(z.object({ path: z.string(), kind: z.string(), title: z.string() })).min(1),
  }),
  output: z.object({ projectId: z.string(), files: z.array(z.string()), framework: z.string() }),
  idempotent: true,
  timeoutMs: 120_000,
  async execute() {
    throw new Error("site.scaffold live generator is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "site.scaffold", input.layoutArchetype);
    const files = [
      "package.json", "astro.config.mjs", "src/styles/tokens.css", "src/layouts/Base.astro",
      ...input.pages.map((p) => `src/pages${p.path === "/" ? "/index" : p.path}.astro`),
    ];
    return { projectId: fakeId(rng, "site"), files, framework: input.framework };
  },
});

export const siteBuild = defineTool({
  id: "site.build",
  version: "1.0.0",
  title: "Build a generated site",
  description:
    "Runs the generated project's production build in an isolated workspace and returns the exact routes and diagnostics. It does not deploy or publish; a failed build leaves the previous deployment untouched.",
  scopes: ["site:build"],
  sideEffect: "write",
  input: z.object({
    projectId: z.string().min(1),
    framework: z.enum(["astro", "next"]),
    expectedRoutes: z.array(z.string().startsWith("/")).min(1),
  }),
  output: z.object({
    buildId: z.string(),
    ok: z.boolean(),
    routes: z.array(z.string()),
    warnings: z.array(z.string()),
    durationMs: z.number().int().nonnegative(),
  }),
  idempotent: true,
  timeoutMs: 180_000,
  async execute() {
    throw new Error("site.build live isolated builder is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "site.build", input.projectId);
    return {
      buildId: fakeId(rng, "build"),
      ok: true,
      routes: input.expectedRoutes,
      warnings: [],
      durationMs: rng.int(1_800, 8_500),
    };
  },
});

export const siteDeploy = defineTool({
  id: "site.deploy",
  version: "1.0.0",
  title: "Deploy a site",
  description:
    "Builds and deploys the scaffolded project to a hosting provider, returning a live URL. " +
    "A preview deploy is not visible to the public; a production deploy is, and always " +
    "requires approval. If the build fails, the previous deploy stays live \u2014 this tool never " +
    "leaves a customer with a broken site as a side effect of a failed change.",
  scopes: ["site:deploy"],
  sideEffect: "publish",
  input: z.object({
    projectId: z.string().min(1),
    environment: z.enum(["preview", "production"]).default("preview"),
    domain: z.string().optional(),
  }),
  output: z.object({ deploymentId: z.string(), url: z.string().url(), environment: z.string(), buildOk: z.boolean() }),
  idempotent: true,
  timeoutMs: 300_000,
  async execute() {
    throw new Error("site.deploy live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "site.deploy", input.projectId);
    const id = fakeId(rng, "dpl");
    return {
      deploymentId: id,
      url: input.domain ? `https://${input.domain}` : `https://${id}.simulated-host.app`,
      environment: input.environment,
      buildOk: true,
    };
  },
});

export const dnsConfigure = defineTool({
  id: "dns.configure",
  version: "1.0.0",
  title: "Configure DNS records",
  description:
    "Sets DNS records on a managed zone. Records propagate on their TTL, so a change here is " +
    "not instantly visible and ssl.verify may need a retry for a few minutes afterwards. " +
    "Replacing an MX or TXT record that email authentication depends on will break deliverability, " +
    "so send the full record set rather than a partial one.",
  scopes: ["dns:write"],
  sideEffect: "write",
  input: z.object({
    zone: z.string().min(3),
    records: z.array(z.object({
      type: z.enum(["A", "AAAA", "CNAME", "TXT", "MX", "CAA"]),
      name: z.string(),
      value: z.string(),
      ttl: z.number().int().min(60).default(3600),
      priority: z.number().int().optional(),
    })).min(1),
  }),
  output: z.object({ zone: z.string(), applied: z.number().int(), propagationEstimateSeconds: z.number().int() }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("dns.configure live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input) {
    return { zone: input.zone, applied: input.records.length, propagationEstimateSeconds: 3600 };
  },
});

export const lighthouseAudit = defineTool({
  id: "lighthouse.audit",
  version: "1.0.0",
  title: "Audit a page with Lighthouse",
  description:
    "Runs a Lighthouse audit and returns performance, accessibility, best-practices, and SEO " +
    "scores plus the specific failing audits. The pre-launch quality gate requires performance " +
    "\u2265 90 and accessibility and SEO \u2265 95 on the primary templates, so run this before " +
    "requesting publish rather than after. Scores vary between runs; treat a single point as noise.",
  scopes: ["site:build"],
  sideEffect: "read",
  input: z.object({ url: z.string().url(), formFactor: z.enum(["mobile", "desktop"]).default("mobile") }),
  output: z.object({
    performance: z.number().min(0).max(100),
    accessibility: z.number().min(0).max(100),
    bestPractices: z.number().min(0).max(100),
    seo: z.number().min(0).max(100),
    failures: z.array(z.object({ audit: z.string(), detail: z.string() })),
  }),
  idempotent: false,
  timeoutMs: 120_000,
  async execute() {
    throw new Error("lighthouse.audit live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "lighthouse", input.url);
    // Generated sites are static and token-driven, so scores are realistically high.
    return {
      performance: rng.int(91, 99),
      accessibility: rng.int(96, 100),
      bestPractices: rng.int(92, 100),
      seo: rng.int(96, 100),
      failures: [],
    };
  },
});

export const sslVerify = defineTool({
  id: "ssl.verify",
  version: "1.0.0",
  title: "Verify TLS for a domain",
  description:
    "Checks that a domain serves a valid certificate covering the exact hostname and reports " +
    "days to expiry. Run it after dns.configure and before publish. A failure immediately " +
    "after a DNS change usually means propagation rather than misconfiguration \u2014 retry after " +
    "a few minutes before treating it as an error.",
  scopes: ["site:deploy"],
  sideEffect: "read",
  input: z.object({ domain: z.string().min(3) }),
  output: z.object({ valid: z.boolean(), issuer: z.string(), daysToExpiry: z.number().int(), coversHost: z.boolean() }),
  idempotent: false,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("ssl.verify live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "ssl.verify", input.domain);
    return { valid: true, issuer: "Simulated CA", daysToExpiry: rng.int(60, 90), coversHost: true };
  },
});

export const redirectSet = defineTool({
  id: "redirect.set",
  version: "1.0.0",
  title: "Set redirects",
  description:
    "Creates permanent or temporary redirects. Use 301 only when the move is genuinely " +
    "permanent, because search engines and browsers cache them aggressively and a wrong 301 is " +
    "painful to undo. Redirect chains longer than one hop are refused.",
  scopes: ["site:deploy"],
  sideEffect: "write",
  input: z.object({
    rules: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), status: z.union([z.literal(301), z.literal(302)]).default(301) })).min(1),
  }),
  output: z.object({ applied: z.number().int(), rejected: z.array(z.object({ from: z.string(), reason: z.string() })) }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("redirect.set live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input) {
    const targets = new Set(input.rules.map((r) => r.from));
    const rejected = input.rules.filter((r) => targets.has(r.to)).map((r) => ({ from: r.from, reason: "would create a redirect chain" }));
    return { applied: input.rules.length - rejected.length, rejected };
  },
});

export const siteTools: readonly AnyTool[] = [siteScaffold, siteBuild, siteDeploy, dnsConfigure, sslVerify, redirectSet, lighthouseAudit];
