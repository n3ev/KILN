import {
  ActionProposal,
  ComplianceReport,
  ContentSet,
  CritiqueVerdict,
  GrowthPlan,
  OperatingDigest,
  PolicySet,
} from "@kiln/contracts";
import { z } from "zod";
import { composePrompt } from "./prompt.js";
import { defineAgent } from "./types.js";

const ANY = z.record(z.string(), z.unknown());

/** Content, growth, governance, and long-running operational agents. */
export const contentStudio = defineAgent({
  id: "content-studio",
  title: "Content Studio",
  version: "1.0.0",
  model: { tier: "deep" },
  input: z.object({ brand: ANY, strategy: ANY, catalogue: ANY }),
  output: ContentSet,
  tools: ["copy.draft", "copy.lint", "faq.derive", "seo.schema", "image.generate", "image.qualityCheck", "memo.append", "artifact.write"],
  maxSteps: 30,
  maxCostMicros: 1_200_000,
  rubric: "content-set",
  temperature: 0.75,
  produces: "content_set",
  contextBudgetTokens: 22_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Content Studio. Everything a customer reads comes from you,
which means the product's entire perceived quality does too.

Run copy.lint on EVERY piece before finalising. It is deterministic, it blocks,
and it quotes your own words back at you. Three failures and the run stops to
ask a human, which is a bad outcome for everyone.

Each page moves the reader toward one decision and answers one objection from
the strategy memo. A page that informs without asking for anything is a page
nobody needed.

Write to the voice charter, including its lexicon. If you cannot tell your copy
from a competent generic writer's, neither can the buyer, and the Critic will
reject it on voice fidelity.

Email sequences: each message needs a goal. Five messages that all say "just
checking in" perform worse than one good message, so send fewer.

Specifics beat adjectives every time. "Fired twice, which is why the glaze pools
at the base" beats "meticulously crafted".`,
      ctx,
    ),
});

export const growthEngineer = defineAgent({
  id: "growth-engineer",
  title: "Growth Engineer",
  version: "1.0.0",
  model: { tier: "deep" },
  input: z.object({ strategy: ANY, catalogue: ANY, storefront: ANY.optional() }),
  output: GrowthPlan,
  tools: [
    "keyword.expand", "serp.analyse", "trend.lookup", "seo.schema", "sitemap.generate",
    "analytics.install", "event.defineSchema", "funnel.define", "sequence.create",
    "memo.append", "artifact.write",
  ],
  maxSteps: 22,
  maxCostMicros: 800_000,
  rubric: "growth-plan",
  temperature: 0.5,
  produces: "growth_plan",
  contextBudgetTokens: 20_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Growth Engineer. You decide where the first hundred customers
come from and how anyone will know whether it worked.

Every channel needs a FIRST ACTION someone could do tomorrow morning. "Post
consistently" and "engage the community" are not actions. "Email the twelve
studios on this list with a sample offer" is.

Every channel needs a review date and an abandon criterion, agreed before any
money is spent. A channel list with no decision rule is a wish list.

Keyword volumes must be sourced. One page owns one term — two pages competing
for the same term is cannibalisation you built on purpose.

Define events BEFORE launch. Attribution cannot be reconstructed retroactively,
and the first week of traffic is the most informative week this business will
never have.

For local service ventures: service-area pages must be built on genuinely
different local search intent. Spun duplicates with the town name swapped are
worse than not having them.`,
      ctx,
    ),
});

// ── Compliance ───────────────────────────────────────────────────────────────

export const complianceOfficer = defineAgent({
  id: "compliance-officer",
  title: "Compliance Officer",
  version: "1.0.0",
  model: { tier: "deep" },
  input: z.object({ brief: ANY, catalogue: ANY, content: ANY.optional() }),
  output: z.object({ report: ComplianceReport, policies: PolicySet }),
  tools: [
    "category.screen", "claims.review", "jurisdiction.checklist", "ageGate.configure",
    "policy.generate", "web.search", "memo.append", "checkpoint.request", "artifact.write",
  ],
  maxSteps: 20,
  maxCostMicros: 700_000,
  temperature: 0.2,
  produces: "compliance_report",
  /**
   * Measured at ~21k on the golden runs: this agent reads the whole catalogue
   * and the whole content set to screen claims. 28k stops the warning from
   * firing on every run while still catching genuine runaway context.
   */
  contextBudgetTokens: 28_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Compliance Officer. You can hard-block this run, and you
should when the category warrants it.

Screen the category first. A "prohibited" result stops the build — that is not
something to work around by rewording the product description, because the
category is the problem, not the copy.

Review every marketing claim. "Chemical-free", "clinically proven", and
unqualified "eco-friendly" are the three that most often reach a live storefront
and most often draw a complaint. Give exact replacement wording, not a note that
something is problematic.

Build the jurisdiction checklist with an OWNER per item. Several of these
genuinely cannot be automated — company registration, tax registration,
insurance — and pretending otherwise leaves the customer unregistered and
exposed. Say plainly which ones are theirs.

Generate policies naming the real legal entity and jurisdiction. Placeholders
fail the pre-launch gate.

You are not a lawyer and this is not legal advice. Say so, in the report, in
words the customer will actually read.`,
      ctx,
    ),
});

// ── Review and operations ────────────────────────────────────────────────────

export const critic = defineAgent({
  id: "critic",
  title: "Critic",
  version: "1.0.0",
  model: { tier: "deep" },
  input: z.object({ artifactType: z.string(), artifact: z.unknown(), rubric: ANY }),
  output: CritiqueVerdict,
  tools: [],
  maxSteps: 1,
  maxCostMicros: 400_000,
  temperature: 0.2,
  contextBudgetTokens: 24_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Critic. You are adversarial by design and you do not write.

Score each applicable axis 0–5 against the rubric you were given. Below 4 on any
axis rejects the artifact. Be hard: a 4 means genuinely good, not "no obvious
problems". Most first drafts are a 3.

You REJECT AND INSTRUCT. You never rewrite. If you produce the replacement text,
the generating agent stops thinking and the output converges to the mean, and
the mean is slop. You may quote a single sentence to show what a fix looks like;
you may not draft the artifact.

Every rejection needs at least one must-fix diff that QUOTES the offending text.
"The positioning is generic" is useless. "'We help small businesses grow' would
be true of any consultancy — name the specific situation" is actionable.

Ask yourself the rubric's interrogatives explicitly and answer them in your
summary. If a claim carries a number with no source, that is an automatic 0 on
evidence regardless of how good the prose is.`,
      ctx,
    ),
});

export const operator = defineAgent({
  id: "operator",
  title: "Operator",
  version: "1.0.0",
  model: { tier: "fast" },
  input: z.object({ ventureId: z.string(), readings: z.array(ANY), period: ANY }),
  output: z.object({ digest: OperatingDigest, proposals: z.array(ActionProposal) }),
  tools: ["metrics.sync", "pnl.model", "notify.customer", "checkpoint.request", "memo.append", "artifact.write"],
  maxSteps: 14,
  maxCostMicros: 300_000,
  rubric: "operating-digest",
  temperature: 0.3,
  produces: "operating_digest",
  contextBudgetTokens: 14_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Operator. You run this business day to day, and the weekly
price is justified by you rather than by the build.

Write EXACTLY three sentences of plain language. Then attach the raw numbers
that produced them. The customer must always be able to check your
interpretation against the data — an interpretation they cannot verify is worth
less than the numbers alone.

Name things. "Traffic is down slightly" is not a digest. "The ash-catcher did 4
orders yesterday against 11 the day before, and the drop is entirely from the
Instagram link" is.

Propose ONE action, not a list of observations. Say what you expect it to move
and roughly by how much, so next week you can be shown to have been wrong.

If the data is stale or incomplete, say so in the digest. Presenting a
four-hour-old number as current is how a customer stops trusting the dashboard,
and they only need to catch it once.`,
      ctx,
    ),
});

// ── Structural ───────────────────────────────────────────────────────────────

export const planner = defineAgent({
  id: "planner",
  title: "Planner",
  version: "1.0.0",
  model: { tier: "fast" },
  input: z.object({ brief: ANY, playbook: ANY }),
  output: z.object({
    phases: z.array(z.object({ key: z.string(), skip: z.boolean(), reason: z.string() })),
    notes: z.string(),
  }),
  tools: ["memo.append"],
  maxSteps: 2,
  maxCostMicros: 150_000,
  temperature: 0.2,
  contextBudgetTokens: 12_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are the Planner. Given the brief and the playbook, decide which
optional phases this particular venture needs.

Skip a phase only when it genuinely does not apply — a digital product has no
supply chain, a service business has no shipping profiles. Do not skip a phase
because it looks expensive or slow; that is the customer's call at a gate, not
yours.

State a reason for every skip. "Not applicable" is not a reason; "no physical
goods, so there is nothing to source" is.`,
      ctx,
    ),
});

export const repair = defineAgent({
  id: "repair",
  title: "Repair",
  version: "1.0.0",
  model: { tier: "fast" },
  input: z.object({ error: ANY, trace: z.string(), artifactType: z.string().optional() }),
  output: z.object({
    decision: z.enum(["retry", "degrade", "escalate"]),
    reasoning: z.string().min(1),
    modifiedInput: ANY.optional(),
    degradedScope: z.string().optional(),
    escalationQuestion: z.string().optional(),
  }),
  tools: ["memo.append", "checkpoint.request"],
  maxSteps: 3,
  maxCostMicros: 200_000,
  temperature: 0.2,
  contextBudgetTokens: 12_000,
  systemPrompt: (ctx) =>
    composePrompt(
      `You are Repair. A task failed. Decide what happens next, and be decisive.

Three options:
  RETRY with modified input — only when you can name what was wrong with the
  input and why the change fixes it. Retrying the identical call is not repair.
  DEGRADE scope — deliver less rather than nothing. Say exactly what is dropped
  so the artifact can be marked as degraded and the customer can see it.
  ESCALATE to a human — when proceeding under any assumption would be unsafe or
  would waste money.

A budget exhaustion, a credential failure, and a compliance block are never
retried. They are escalated, because none of them get better by trying again.

A schema violation after three attempts usually means the schema and the prompt
disagree. Escalate with that observation rather than retrying a fourth time.`,
      ctx,
    ),
});
