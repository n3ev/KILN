import { z } from "zod";
import { defineTool, type AnyTool, type ToolContext } from "../../core/define.js";
import { fakeId, isoFor, requireLive, seedFor, slugify, units } from "../_helpers.js";

/** Naming, domains, handles, and preliminary trademark screening. */

const TLDS = ["com", "co", "co.uk", "shop", "store", "studio", "supply"] as const;

export const nameGenerate = defineTool({
  id: "name.generate",
  version: "1.0.0",
  title: "Generate name candidates",
  description:
    "Produces brand name candidates for a positioning, each with a short rationale. It only " +
    "generates: it does not check availability (call domain.check and handle.check) and it " +
    "does not clear trademarks (call trademark.preliminaryScreen, which is advisory only). " +
    "Supply the ICP and differentiation thesis in `context` — names generated from a category " +
    "alone come back generic.",
  scopes: ["identity:read"],
  sideEffect: "none",
  input: z.object({
    context: z.string().min(10),
    count: z.number().int().min(1).max(30).default(8),
    styles: z.array(z.enum(["descriptive", "evocative", "compound", "invented", "founder", "place"])).default(["evocative", "compound"]),
    avoid: z.array(z.string()).default([]),
  }),
  output: z.object({
    candidates: z.array(z.object({ name: z.string(), style: z.string(), rationale: z.string() })),
  }),
  idempotent: true,
  timeoutMs: 10_000,
  // Pure computation with no network call, so the live path and the simulated
  // path are legitimately the same code rather than one stubbing the other.
  execute: generateNames,
  simulate: generateNames,
});

async function generateNames(
  input: { context: string; count: number; styles: string[]; avoid: string[] },
  ctx: ToolContext,
): Promise<{ candidates: { name: string; style: string; rationale: string }[] }> {
  {
    const rng = seedFor(ctx, "name.generate", input.context);
    const roots = ["Kiln", "Ember", "Quarry", "Thread", "Anvil", "Hollow", "Ledger", "Cinder", "Marrow", "Tinder", "Loom", "Bramble"];
    const tails = ["", " & Co", " Works", " Supply", " Studio", "field", "wright", "stone"];
    const seen = new Set(input.avoid.map((a) => a.toLowerCase()));
    const candidates: { name: string; style: string; rationale: string }[] = [];

    while (candidates.length < input.count && seen.size < 200) {
      const name = `${rng.pick(roots)}${rng.pick(tails)}`.trim();
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      candidates.push({
        name,
        style: rng.pick(input.styles),
        rationale: `Short, says nothing false, and leaves room to widen the range later.`,
      });
    }
    return { candidates };
  }
}

export const domainCheck = defineTool({
  id: "domain.check",
  version: "1.0.0",
  title: "Check domain availability",
  description:
    "Checks availability and price for domains, in bulk and across TLDs. This is the QUOTE " +
    "half of the two-phase spend pattern: it costs nothing, and its `quoteId` is what " +
    "domain.register later requires. Prices are registrar quotes including first-year and " +
    "renewal cost; renewal is usually higher and is the number that matters. Availability is " +
    "accurate at the moment of the call and can change within minutes.",
  scopes: ["identity:read"],
  sideEffect: "read",
  input: z.object({
    names: z.array(z.string().min(1)).min(1).max(50),
    tlds: z.array(z.string()).default([...TLDS]),
  }),
  output: z.object({
    quoteId: z.string(),
    expiresAt: z.string(),
    results: z.array(
      z.object({
        domain: z.string(),
        available: z.boolean(),
        priceMicros: z.number().int().optional(),
        renewalMicros: z.number().int().optional(),
        premium: z.boolean().default(false),
      }),
    ),
  }),
  idempotent: true,
  timeoutMs: 20_000,
  async execute() {
    requireLive("domain.check", "domainRegistration", "Requires a registrar reseller account.");
    throw new Error("domain.check live registrar adapter is wired in prompt 2.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "domain.check", input.names.join(","));
    const results = input.names.flatMap((name) =>
      input.tlds.map((tld) => {
        const domain = `${slugify(name)}.${tld}`;
        // Short .com names are realistically almost never free.
        const available = tld === "com" ? rng.bool(0.18) : rng.bool(0.62);
        const premium = available && rng.bool(0.1);
        return {
          domain,
          available,
          ...(available
            ? {
                priceMicros: premium ? units(rng.int(200, 3000)) : units(rng.int(8, 24)),
                renewalMicros: units(rng.int(12, 38)),
              }
            : {}),
          premium,
        };
      }),
    );
    return { quoteId: fakeId(rng, "dq"), expiresAt: isoFor(ctx, `domain.check:${input.names.join(",")}`, 1), results };
  },
});

export const domainRegister = defineTool({
  id: "domain.register",
  version: "1.0.0",
  title: "Register a domain",
  description:
    "Registers one domain. This SPENDS REAL MONEY and is the COMMIT half of the two-phase " +
    "spend pattern: it accepts an `authorisationId` and the `quoteId` from the domain.check " +
    "call that priced it, and refuses if the authorisation has expired, the price exceeds the " +
    "ceiling, or the quote does not match. Registration is effectively irreversible — there " +
    "is no refund and the name is held for a year. Under managed ownership KILN registers it " +
    "on the customer's behalf and it is transferable to them at any time via handover.",
  scopes: ["identity:register", "spend:external"],
  sideEffect: "spend",
  input: z.object({
    domain: z.string().min(3),
    quoteId: z.string().min(1),
    years: z.number().int().min(1).max(10).default(1),
    privacy: z.boolean().default(true),
    autoRenew: z.boolean().default(true),
  }),
  output: z.object({
    domain: z.string(),
    registrar: z.string(),
    externalId: z.string(),
    expiresAt: z.string(),
    nameservers: z.array(z.string()),
    paidMicros: z.number().int(),
  }),
  costEstimate: (input) => units(20) * input.years,
  idempotent: true,
  idempotencyIgnore: ["quoteId"],
  timeoutMs: 60_000,
  async execute() {
    requireLive("domain.register", "domainRegistration", "Requires a registrar reseller account and KYC.");
    throw new Error("domain.register live registrar adapter is wired in prompt 2.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "domain.register", input.domain);
    return {
      domain: input.domain,
      registrar: "simulated-registrar",
      externalId: fakeId(rng, "dom"),
      expiresAt: isoFor(ctx, `domain.register:${input.domain}`, 365 * input.years),
      nameservers: ["ns1.simulated-dns.net", "ns2.simulated-dns.net"],
      paidMicros: units(rng.int(9, 24)) * input.years,
    };
  },
});

export const handleCheck = defineTool({
  id: "handle.check",
  version: "1.0.0",
  title: "Check social handle availability",
  description:
    "Checks whether a handle is free on the major social platforms. Availability here is " +
    "weaker evidence than domain availability: platforms reclaim dormant handles, and a free " +
    "handle can be taken between this call and registration. Use it to compare candidates, " +
    "not to guarantee anything. It does not register anything.",
  scopes: ["identity:read"],
  sideEffect: "read",
  input: z.object({
    handles: z.array(z.string().min(1)).min(1).max(20),
    platforms: z.array(z.enum(["instagram", "tiktok", "x", "youtube", "pinterest", "linkedin"])).default(["instagram", "tiktok", "x"]),
  }),
  output: z.object({
    results: z.array(z.object({ handle: z.string(), platform: z.string(), available: z.boolean() })),
  }),
  idempotent: true,
  timeoutMs: 20_000,
  async execute() {
    throw new Error("handle.check live adapter is enabled in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "handle.check", input.handles.join(","));
    return {
      results: input.handles.flatMap((handle) =>
        input.platforms.map((platform) => ({
          handle: slugify(handle).replace(/-/g, ""),
          platform,
          available: rng.bool(0.45),
        })),
      ),
    };
  },
});

export const trademarkPreliminaryScreen = defineTool({
  id: "trademark.preliminaryScreen",
  version: "1.0.0",
  title: "Preliminary trademark search (advisory)",
  description:
    "Searches public trademark registers for identical and near-identical marks in the " +
    "relevant classes. THIS IS A SEARCH, NOT LEGAL CLEARANCE. Its output is advisory and must " +
    "always be presented as such to the customer: a clear result does not mean the name is " +
    "safe to use, and only a qualified attorney can advise on that. Use it to eliminate " +
    "obviously conflicted candidates early, never to approve one.",
  scopes: ["identity:read"],
  sideEffect: "read",
  input: z.object({
    name: z.string().min(1),
    jurisdictions: z.array(z.string().length(2)).default(["GB", "US"]),
    niceClasses: z.array(z.number().int().min(1).max(45)).default([]),
  }),
  output: z.object({
    status: z.enum(["clear-on-search", "possible-conflict", "conflict", "not-screened"]),
    advisory: z.literal(true),
    matches: z.array(
      z.object({ mark: z.string(), jurisdiction: z.string(), classes: z.array(z.number().int()), status: z.string() }),
    ),
    notes: z.string(),
  }),
  idempotent: true,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("trademark.preliminaryScreen live adapter is enabled in prompt 2; run in sandbox mode.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "trademark.screen", input.name);
    const conflicted = rng.bool(0.25);
    return {
      status: conflicted ? ("possible-conflict" as const) : ("clear-on-search" as const),
      advisory: true as const,
      matches: conflicted
        ? [{ mark: input.name.toUpperCase(), jurisdiction: input.jurisdictions[0] ?? "GB", classes: [21, 35], status: "registered" }]
        : [],
      notes:
        "Search of public registers only. This is not legal clearance and must be presented " +
        "to the customer as advisory. Recommend an attorney review before any filing or spend " +
        "on packaging and signage.",
    };
  },
});

export const identityTools: readonly AnyTool[] = [
  nameGenerate,
  domainCheck,
  domainRegister,
  handleCheck,
  trademarkPreliminaryScreen,
];
