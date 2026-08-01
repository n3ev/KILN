import { z } from "zod";
import { defineTool, type AnyTool } from "../../core/define.js";
import { fakeId, isoFor, seedFor, slugify } from "../_helpers.js";

/** Analytics installation, event schemas, and metric sync into the mirror. */

export const analyticsInstall = defineTool({
  id: "analytics.install",
  version: "1.0.0",
  title: "Install analytics",
  description:
    "Installs a privacy-respecting analytics tag on the storefront and returns the property id. " +
    "Install BEFORE launch: attribution cannot be reconstructed retroactively, and the first " +
    "week of traffic is the most informative week the business will have. Cookieless providers " +
    "avoid a consent banner in most jurisdictions, which is why one is the default.",
  scopes: ["analytics:write"],
  sideEffect: "write",
  input: z.object({ provider: z.enum(["plausible", "ga4", "umami"]).default("plausible"), domain: z.string().min(3) }),
  output: z.object({ provider: z.string(), propertyId: z.string(), snippet: z.string(), cookieless: z.boolean() }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("analytics.install live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "analytics.install", input.domain);
    const cookieless = input.provider !== "ga4";
    return {
      provider: input.provider,
      propertyId: fakeId(rng, "prop"),
      snippet: `<script defer data-domain="${input.domain}" src="https://simulated-analytics.io/js/script.js"></script>`,
      cookieless,
    };
  },
});

export const eventDefineSchema = defineTool({
  id: "event.defineSchema",
  version: "1.0.0",
  title: "Define the event schema",
  description:
    "Declares the events the storefront will emit and their properties, before any of them " +
    "fire. Defining events up front is what makes a funnel measurable later; retrofitting them " +
    "means the first month has no data. Keep names stable \u2014 renaming an event splits its history.",
  scopes: ["analytics:write"],
  sideEffect: "write",
  input: z.object({
    events: z.array(z.object({ name: z.string().min(1), firesWhen: z.string().min(1), properties: z.array(z.string()).default([]) })).min(1),
  }),
  output: z.object({ defined: z.number().int(), names: z.array(z.string()) }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("event.defineSchema live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input) {
    return { defined: input.events.length, names: input.events.map((e) => e.name) };
  },
});

export const pixelInstall = defineTool({
  id: "pixel.install",
  version: "1.0.0",
  title: "Install an advertising pixel",
  description:
    "Installs an advertising platform's conversion pixel. This one DOES set third-party " +
    "cookies, so it requires consent handling in most jurisdictions and the compliance " +
    "checklist must reflect that. Install only for channels the growth plan actually intends " +
    "to use \u2014 an unused pixel is pure liability.",
  scopes: ["analytics:write"],
  sideEffect: "write",
  input: z.object({ platform: z.enum(["meta", "tiktok", "google-ads", "pinterest"]), pixelId: z.string().min(1), consentRequired: z.boolean().default(true) }),
  output: z.object({ platform: z.string(), installed: z.boolean(), consentRequired: z.boolean(), snippet: z.string() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("pixel.install live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input) {
    return {
      platform: input.platform,
      installed: true,
      consentRequired: input.consentRequired,
      snippet: `<!-- ${input.platform} pixel ${input.pixelId} (simulated) -->`,
    };
  },
});

export const metricsSync = defineTool({
  id: "metrics.sync",
  version: "1.0.0",
  title: "Sync metrics into the mirror",
  description:
    "Pulls a rolling window of metrics from a connected provider and normalises them into " +
    "KILN's canonical vocabulary. Always pulls a window rather than only new rows, because " +
    "webhooks are lossy and reconciliation is what repairs the gaps. Returns how many points " +
    "were written and the new cursor.",
  scopes: ["analytics:read"],
  sideEffect: "read",
  input: z.object({
    provider: z.enum(["shopify", "stripe", "analytics", "resend", "cal-com", "ads"]),
    windowDays: z.number().int().min(1).max(90).default(7),
    cursor: z.string().optional(),
  }),
  output: z.object({
    provider: z.string(),
    points: z.array(z.object({ metricKey: z.string(), ts: z.string(), value: z.number(), dimensions: z.record(z.string(), z.string()) })),
    cursor: z.string(),
    gapsRepaired: z.number().int(),
  }),
  idempotent: true,
  idempotencyIgnore: ["cursor"],
  timeoutMs: 120_000,
  async execute() {
    throw new Error("metrics.sync live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "metrics.sync", input.provider);
    const keys = input.provider === "stripe" ? ["revenue_net", "orders"] : input.provider === "analytics" ? ["sessions", "conversion_rate"] : ["revenue_gross", "orders", "units"];
    const points = [];
    const base = new Date(isoFor(ctx, `metrics.sync:${input.provider}`)).getTime();
    for (let day = input.windowDays - 1; day >= 0; day--) {
      const ts = new Date(base - day * 86_400_000).toISOString().slice(0, 10) + "T00:00:00.000Z";
      for (const metricKey of keys) {
        points.push({
          metricKey,
          ts,
          value: metricKey.startsWith("revenue") ? rng.int(0, 40) * 1_000_000 : metricKey === "conversion_rate" ? Math.round(rng.float(0.004, 0.035) * 1000) / 1000 : rng.int(0, 60),
          dimensions: {},
        });
      }
    }
    return { provider: input.provider, points, cursor: isoFor(ctx, `metrics.cursor:${input.provider}`), gapsRepaired: rng.int(0, 2) };
  },
});

export const funnelDefine = defineTool({
  id: "funnel.define",
  version: "1.0.0",
  title: "Define a funnel",
  description:
    "Defines an ordered funnel over previously declared events so drop-off is measurable. " +
    "Every step must reference an event from event.defineSchema; a funnel over events that do " +
    "not fire reports 100% drop-off and looks like a catastrophe rather than a configuration " +
    "error.",
  scopes: ["analytics:write"],
  sideEffect: "write",
  input: z.object({ name: z.string().min(1), steps: z.array(z.string().min(1)).min(2) }),
  output: z.object({ funnelId: z.string(), stepCount: z.number().int() }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("funnel.define live adapter is wired in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    return { funnelId: fakeId(seedFor(ctx, "funnel", input.name), "fun"), stepCount: input.steps.length };
  },
});

export const analyticsTools: readonly AnyTool[] = [analyticsInstall, eventDefineSchema, pixelInstall, metricsSync, funnelDefine];
