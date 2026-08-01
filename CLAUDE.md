# KILN — Master Build Prompt (Prompt 1 of 5)

> **How to use this file.** Paste everything below the line marked `=== BEGIN PROMPT ===` into a capable coding agent (Claude Code, Cursor Composer, Codex, etc.) as a single message. It is written as an instruction set for that agent, not as documentation for a human. Section 24 tells you exactly what prompts 2–5 should contain, and what must already exist before you send them.
>
> **Naming.** The product is called **KILN** throughout. Rename with a single find-and-replace if you want something else; the package namespace is `@kiln/*`.
>
> **On the AI provider.** Every AI key is deliberately left blank. The system ships with a deterministic **mock provider** that replays recorded fixtures, so the entire product — intake, orchestration, tool calls, artifacts, dashboards, billing — runs end to end with zero credentials. Adding a Kimi or DeepSeek key later is a one-line `.env` change and requires no code edits.

---

=== BEGIN PROMPT ===

You are building **KILN**, a production-grade platform that takes a person's business idea and stands up a real, operating business around it — sourcing, storefront, brand, content, compliance, launch, and ongoing operations — using a fleet of specialised AI agents with typed, permissioned tools.

This is a premium product. Customers pay **$199–$1,200 per week**. Every decision you make should be defensible against that price. Read this entire document before writing a single file.

---

## 1. What KILN actually is

A customer arrives with one sentence: *"I want to sell handmade ceramic incense holders to people who are into slow living."* Or: *"I want to run a mobile bike repair service in Leeds."* Or: *"I want to sell a Notion template system for freelance designers."*

KILN then does the following, mostly unattended, with the customer watching it happen live:

1. **Interrogates the idea** — a short, sharp structured intake that extracts the twelve things that actually determine whether a business works, and refuses to move on until they are answered or explicitly deferred.
2. **Validates it** — real demand signals, competitor teardown, keyword and channel analysis, unit-economics model. Produces a go / reshape / kill recommendation with evidence, and is allowed to say kill.
3. **Positions it** — ICP, offer architecture, price ladder, differentiation thesis, objection map.
4. **Brands it** — name candidates with live domain and handle availability, a voice charter, a generated design token set (type, palette, spacing, motion), logo and mark, and an asset kit. Not a template with the hue rotated.
5. **Builds the product surface** — a Shopify store, a digital product plus checkout, or a service booking site, depending on archetype. Real SKUs, real supplier quotes, real margins, real shipping profiles, real policy pages.
6. **Fills it with content that does not read like AI wrote it** — product copy, landing pages, email sequences, launch posts, all passed through an adversarial critic and a hard-blocking slop linter.
7. **Clears compliance** — restricted-category screening, jurisdictional checklist, generated policies, claims review.
8. **Launches it** — domain, DNS, email domain authentication, analytics, tracking, first campaign scaffolding.
9. **Operates it** — a daily loop that pulls live numbers from Shopify, Stripe, and analytics, surfaces them in KILN's own dashboard, flags problems, and proposes or executes the next action.

The customer never has to touch Shopify's admin, DNS records, or a supplier portal. They watch a build happen, approve at a handful of gates if they want gates, and then look at one clean dashboard that says how much money the business made yesterday.

### 1.1 Why anyone pays this much

Be clear about the value proposition, because it constrains the build:

- **Compression.** Six to ten weeks of founder work in a few hours.
- **Execution, not advice.** The output is a live store with orders flowing, not a strategy PDF. Every artifact must be *deployed* or *deployable with one click*, never merely described.
- **Operating leverage.** The weekly price is justified by the ongoing operator loop, not the one-time build. Design for week 40, not week 1.
- **Taste.** The single biggest differentiator. If the output looks like AI slop, the product is worth $20/month, not $500/week. Section 3 is not optional garnish; it is the moat.

---

## 2. Non-negotiable engineering principles

1. **Runs with no keys.** `pnpm install && pnpm db:push && pnpm seed && pnpm dev` must produce a fully working application against zero external services. Mock adapters everywhere. This is a hard acceptance criterion, not a nicety.
2. **Everything is typed end to end.** Zod schemas are the single source of truth; infer TypeScript types from them; derive DB columns and JSON contracts from them. No `any`. No unvalidated JSON crossing a boundary.
3. **Durable, resumable, replayable.** A run must survive process death, deploys, and multi-day human approval waits. Every run can be replayed from its event log to reproduce the exact artifact set.
4. **Every side effect is a tool call.** Agents never touch the network, the filesystem, or the database directly. They emit tool calls that pass through permission, budget, and audit layers. No exceptions.
5. **Money is accounted for at the point of spend.** Tokens, image generations, domain registrations, ad spend — all reserved against a budget envelope *before* the spend, all written to a cost ledger.
6. **Untrusted content is quarantined.** Anything fetched from the web is data, never instruction. It is wrapped in delimiters, stripped of instruction-like patterns, and the model is told explicitly it may not follow it.
7. **Small, honest modules.** No file over ~400 lines. No god-objects. If a package needs a diagram to explain, split it.
8. **Failure is a first-class state.** Every phase, tool, and agent has defined failure, retry, degrade, and escalate behaviour. Never silently continue with a half-built artifact.

---

## 3. The anti-slop doctrine (read twice)

The default output of a language model is fluent, symmetrical, and dead. KILN's entire premium positioning rests on refusing that. Implement all of the following as *code*, not as prompt suggestions.

### 3.1 The slop linter — `packages/quality/slop-lint`

A deterministic, non-AI linter that runs on every piece of customer-facing copy before it can be written as an artifact. It **blocks** on:

- A banned-phrase dictionary, versioned in `packages/quality/dictionaries/banned.json`. Seed it with at least: *elevate your, unlock the power, in today's fast-paced world, game-changer, seamlessly, revolutionise, take it to the next level, look no further, dive into, delve, tapestry, testament to, nestled in, whether you're a … or a …, it's not just X, it's Y, at the end of the day, robust solution, cutting-edge, world-class, curated collection, journey, meticulously crafted, perfect for those who.*
- Structural tells: three or more consecutive sentences of within-10% equal length; more than one em-dash per 150 words; tricolon ("X, Y, and Z") density above 1 per 120 words; any paragraph opening with a participial phrase more than twice per document; "Not only … but also"; rhetorical-question openers.
- Placeholder residue: `lorem`, `TODO`, `[insert`, `Your Brand`, `example.com`, unresolved `{{`.
- Emoji in body copy unless the brand voice charter explicitly enables it.
- Heading-to-body ratio above 1:4 (a symptom of listicle-brain output).

Blocked copy is returned to the generating agent with the *specific* offending spans and a rewrite instruction. Maximum three repair cycles, then escalate to a checkpoint.

### 3.2 The Critic agent

A separate agent with a different system prompt and adversarial framing. It scores each artifact against a per-artifact-type rubric (0–5 on: specificity, evidence, voice fidelity, differentiation, commercial sharpness, visual craft). Anything scoring below 4 on any axis is rejected with concrete diffs, not vibes. The critic never rewrites; it only rejects and instructs. This separation matters — a model that rewrites its own work converges to mush.

### 3.3 Specificity enforcement

Every generated claim about the market, competitors, pricing, or demand must carry a `source` reference to a fetched document, a tool result, or an explicit `assumption` marker with a stated confidence. Artifacts containing unsourced quantitative claims are rejected automatically. This alone removes most of what people recognise as AI slop.

### 3.4 Visual anti-slop

- Design tokens are **generated per brand** from a constrained but genuinely varied system: a type-pairing catalogue of at least 24 real pairings with licensing metadata, a palette generator working in OKLCH with enforced contrast and a deliberate non-symmetric ramp, a spacing scale chosen from four rhythmic options, a border-radius/edge personality axis, and a motion signature.
- Two runs must never produce visually similar sites. Add a test that generates 50 brands and asserts pairwise distance in token space exceeds a threshold.
- **No purple-to-blue gradients. No glassmorphism by default. No centred hero with a floating dashboard mockup.** Layout archetypes are chosen from a catalogue of at least eight genuinely different editorial structures.
- Generated imagery goes through a quality gate: no malformed text in images, no six-fingered hands, correct aspect ratios, and a per-brand visual direction brief that constrains style so a product set looks coherent rather than like eight different models fought over it.

### 3.5 KILN's own interface

The same rules apply to the product you are building. Section 15 specifies the design system. Do not ship a shadcn default with `slate` and a purple accent.

---

## 4. Stack

Locked. Do not substitute without recording an ADR in `docs/adr/`.

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript 5.6+, `strict: true` | `noUncheckedIndexedAccess` on |
| Runtime | Node 22 LTS | Workers may use the same |
| Monorepo | pnpm workspaces + Turborepo | |
| Web | Next.js 15 (App Router), React 19, RSC-first | |
| Styling | Tailwind CSS v4 + a hand-built primitive layer over Radix | No shadcn dump; see §15 |
| DB | Postgres 16 via Supabase | RLS enforced on every tenant table |
| ORM | Drizzle + drizzle-kit migrations | |
| Auth | Supabase Auth (email OTP + Google), custom session bridge | |
| Object storage | Supabase Storage (S3-compatible), signed URLs only | |
| Durable jobs | Inngest, behind `packages/jobs` abstraction | Must be swappable for a Postgres `FOR UPDATE SKIP LOCKED` queue |
| Realtime | Supabase Realtime for run events + SSE for token streaming | |
| Payments | Stripe (Billing, Checkout, Customer Portal, Connect later) | |
| Email | Resend, behind an adapter | |
| Validation | Zod 3 | Source of truth for all contracts |
| Testing | Vitest, Playwright, Testcontainers | |
| Observability | OpenTelemetry → console in dev, Axiom/Grafana in prod | |
| Deploy | Vercel (web), Fly.io (workers + MCP server), Supabase (data) | |

---

## 5. Repository layout

Create exactly this. Every path listed must exist by the end of prompt 1, even if some files are stubs with a `// TODO(prompt-N)` header naming which later prompt fills them.

```
kiln/
├── apps/
│   ├── web/                        # Next.js 15 — customer app + marketing + admin
│   │   ├── app/
│   │   │   ├── (marketing)/        # public site
│   │   │   ├── (auth)/
│   │   │   ├── (app)/
│   │   │   │   ├── intake/         # the idea wizard
│   │   │   │   ├── runs/[runId]/   # Run Theatre — the centrepiece
│   │   │   │   ├── ventures/[id]/  # live business dashboard
│   │   │   │   ├── artifacts/
│   │   │   │   ├── approvals/
│   │   │   │   ├── billing/
│   │   │   │   └── handover/
│   │   │   ├── (admin)/console/    # operator console: margins, runs, incidents
│   │   │   └── api/
│   │   │       ├── stripe/webhook/
│   │   │       ├── connectors/[provider]/webhook/
│   │   │       ├── runs/[runId]/stream/     # SSE
│   │   │       └── trpc/[trpc]/
│   │   └── ...
│   ├── worker/                     # Fly.io — Inngest functions, sync jobs, cron
│   └── mcp/                        # MCP server exposing the tool catalogue externally
├── packages/
│   ├── db/                         # Drizzle schema, migrations, RLS policies, seed
│   ├── contracts/                  # every Zod schema + inferred types, shared
│   ├── model-gateway/              # provider abstraction: kimi | deepseek | mock
│   ├── agents/                     # agent definitions, prompts, rubrics
│   ├── runtime/                    # orchestrator, state machine, event log, replay
│   ├── tools/                      # the capability catalogue
│   │   ├── core/                   # defineTool, registry, permissions, budget
│   │   └── catalogue/              # one folder per tool domain (§10)
│   ├── playbooks/                  # business archetypes (§11)
│   │   ├── physical-shopify/
│   │   ├── digital-product/
│   │   └── local-service/
│   ├── connectors/                 # outbound integrations + their mock twins
│   ├── vault/                      # credential storage, envelope encryption
│   ├── mirror/                     # metric ingestion + normalisation (§13)
│   ├── billing/                    # Stripe, entitlements, metering, cost ledger
│   ├── quality/                    # slop-lint, rubrics, quality gates
│   ├── design-engine/              # brand token generation, layout archetypes
│   ├── ui/                         # KILN's own design system primitives
│   ├── jobs/                       # durable job abstraction
│   ├── observability/              # tracing, run traces, cost attribution
│   └── config/                     # env parsing (Zod), feature flags
├── fixtures/
│   ├── model/                      # recorded model responses for mock provider
│   ├── connectors/                 # canned Shopify/Stripe/search responses
│   └── runs/                       # three complete golden runs, one per archetype
├── docs/
│   ├── adr/
│   ├── runbooks/
│   └── agent-authoring.md
├── tests/
│   ├── e2e/
│   └── evals/
├── .env.example
├── docker-compose.yml              # postgres + redis + minio for offline dev
├── turbo.json
└── pnpm-workspace.yaml
```

---

## 6. Domain model

Core nouns, in plain language, before the schema:

- **Account** — the paying entity. Has one or more **Users**.
- **Venture** — a business KILN has built or is building. An account may have several.
- **Run** — one execution of a playbook against a venture. Runs have **Phases**, phases have **Tasks**, tasks produce **Artifacts**.
- **Artifact** — a durable, versioned output: a strategy memo, a token set, a product listing, a deployed URL, a policy document. Content-addressed and immutable; changes create new versions.
- **Checkpoint** — a point where the run pauses for human approval. May be auto-approved depending on autonomy level.
- **AgentInvocation** — one call to one agent, with its full message trace, token usage, and cost.
- **ToolCall** — one permissioned side effect, with input, output, latency, cost, and idempotency key.
- **Asset** — an externally-owned resource KILN provisioned: a domain, a Shopify store, a Stripe account, an email domain, a social handle. Has an ownership mode.
- **Credential** — an encrypted secret bound to an asset.
- **MetricSnapshot** — a normalised measurement mirrored from an external system.
- **Approval / Intervention** — human input into a running build.

### 6.1 Schema (Drizzle, `packages/db/schema/`)

Write real Drizzle definitions for all of the below. Split into files by concern: `identity.ts`, `venture.ts`, `run.ts`, `artifact.ts`, `asset.ts`, `billing.ts`, `mirror.ts`, `audit.ts`.

```
accounts            id, name, plan_id, status, autonomy_default, stripe_customer_id,
                    budget_weekly_cents, created_at
users               id, account_id, email, name, role(owner|member|admin), auth_uid
ventures            id, account_id, name, archetype(physical|digital|service),
                    status(draft|building|live|paused|archived|transferred),
                    ownership_mode(managed|delegated|transferred), brief jsonb,
                    primary_domain, created_at
runs                id, venture_id, playbook_id, playbook_version, status,
                    autonomy(supervised|guided|autonomous), current_phase,
                    budget_cents, spent_cents, started_at, ended_at, seed,
                    idempotency_key
run_events          id, run_id, seq (bigserial, unique per run), type, payload jsonb,
                    actor(agent|tool|human|system), created_at   -- the event log; append-only
phases              id, run_id, key, title, status, order_index, started_at, ended_at
tasks               id, phase_id, agent_id, title, status, attempt, input jsonb,
                    output_artifact_id, error jsonb
artifacts           id, venture_id, run_id, type, version, parent_id, status,
                    content jsonb, content_hash, storage_key, quality jsonb,
                    sources jsonb, created_by_task_id, created_at
checkpoints         id, run_id, phase_id, kind, prompt jsonb, options jsonb,
                    status(pending|approved|rejected|expired|auto),
                    decided_by_user_id, decision jsonb, expires_at
agent_invocations   id, task_id, agent_id, model, provider, messages jsonb,
                    prompt_tokens, completion_tokens, cost_micros, latency_ms,
                    status, error
tool_calls          id, task_id, tool_id, tool_version, input jsonb, output jsonb,
                    status, idempotency_key (unique), external_cost_micros,
                    latency_ms, sandboxed bool, created_at
assets              id, venture_id, kind, provider, external_id, display_name,
                    ownership_mode, status, metadata jsonb, provisioned_at
credentials         id, asset_id, ciphertext bytea, dek_wrapped bytea, nonce bytea,
                    scopes text[], rotated_at, expires_at   -- never readable via API
connections         id, venture_id, provider, asset_id, status, last_sync_at,
                    sync_cursor jsonb, health jsonb
metric_snapshots    id, venture_id, provider, metric_key, ts, value numeric,
                    dimensions jsonb, unique(venture_id, provider, metric_key, ts, dimensions_hash)
orders_mirror       id, venture_id, provider, external_id, placed_at, gross_cents,
                    net_cents, currency, items jsonb, customer_ref, status
plans               id, name, price_weekly_cents, entitlements jsonb, active
subscriptions       id, account_id, plan_id, stripe_subscription_id, status,
                    current_period_end, cancel_at
credit_ledger       id, account_id, run_id, delta_micros, kind(grant|spend|refund),
                    reason, metadata jsonb, created_at
cost_ledger         id, run_id, category(model|image|tool|external), ref_id,
                    amount_micros, vendor, created_at
budget_envelopes    id, run_id, category, limit_micros, reserved_micros, spent_micros
audit_log           id, account_id, actor, action, subject_type, subject_id,
                    ip, user_agent, metadata jsonb, created_at
```

Rules:
- Every tenant table gets a Supabase RLS policy scoped by `account_id`, plus a `service_role` bypass used only by workers. Write the policies as SQL in `packages/db/policies/` and test them — include a test that asserts cross-tenant reads fail.
- `run_events` is append-only, enforced by a trigger that rejects `UPDATE` and `DELETE`.
- `credentials.ciphertext` is never selected by any query outside `packages/vault`. Enforce with a lint rule.
- All money is integer `micros` (millionths of a currency unit) to avoid float drift. All display formatting happens once, in `packages/ui`.

---

## 7. Model gateway — `packages/model-gateway`

The AI provider is abstracted behind one interface. **Ship with no key configured.**

```ts
export interface ModelProvider {
  id: 'kimi' | 'deepseek' | 'mock';
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;
  complete(req: ChatRequest): Promise<ChatResult>;   // non-streaming convenience
  countTokens(text: string): number;
  pricing: { promptMicrosPerKTok: number; completionMicrosPerKTok: number };
  capabilities: { toolCalling: boolean; json: boolean; contextWindow: number; vision: boolean };
}
```

Implement three adapters:

**`kimi`** — Moonshot's OpenAI-compatible endpoint. Base URL, model ids, and key all come from env; do not hardcode a model name anywhere, including in defaults. Moonshot does not publish fixed "deep" and "fast" tiers, so `ModelSelector.tier` resolves through a config map (`MODEL_TIER_MAP` JSON in env) that the operator fills in with whatever model ids are current. If a tier is unmapped, fall back to the provider's configured default and log a warning.

**`deepseek`** — DeepSeek's OpenAI-compatible endpoint, same treatment. Support the reasoning-model variant with a `reasoningEffort` passthrough that other providers ignore.

**`mock`** — the default when no key is present. This is the most important adapter in the codebase:
- Loads fixtures from `fixtures/model/` keyed by a stable hash of `(agentId, taskKind, inputDigest)`.
- On a cache miss, returns a *plausible, schema-valid* synthetic response generated from the expected output Zod schema plus a per-agent template library, so unseen inputs still produce a coherent run rather than an error. If synthesis cannot satisfy the schema — recursive types, impossible refinements, unresolvable unions — it throws a typed `SyntheticResponseFailure` carrying the schema path that defeated it. The runtime routes this to the Repair agent, which escalates to a checkpoint. It must never return partially-valid data, and it must never be swallowed.
- Streams token-by-token with realistic jitter so the Run Theatre UI is genuinely exercised.
- Deterministic given the run `seed`.
- Has a `record` mode: when a real key *is* present and `MODEL_RECORD=1`, it writes every real response into `fixtures/model/` so the mock corpus improves for free.

Gateway responsibilities beyond routing:
- **Structured output.** A `generateObject(schema, req)` helper that requests JSON, validates against Zod, and on failure re-prompts with the validation error attached, up to 3 attempts, then throws a typed `SchemaViolation`.
- **Retries** with exponential backoff and jitter on 429/5xx; a circuit breaker per provider.
- **Cost accounting**: every call writes to `cost_ledger` and decrements the run's `budget_envelope` for category `model`. A call that would exceed the envelope throws `BudgetExceeded` *before* the request is made.
- **Prompt caching** where the provider supports it; hash and reuse system-prompt prefixes.
- **Redaction**: no secret, credential, or PII field ever enters a prompt. A `redact()` pass runs on all message content, driven by a rule set in `packages/observability/redaction.ts`.
- **Fallback chain**: `MODEL_FALLBACK_ORDER` env var, e.g. `kimi,deepseek,mock`. If the primary breaks mid-run, degrade rather than fail, and mark affected artifacts with `quality.degraded = true`.

---

## 8. Agent runtime — `packages/runtime`

Do **not** use LangChain, CrewAI, AutoGen, or any similar framework. Hand-roll it. You need control over cost, determinism, replay, and permissions that those frameworks do not give you.

### 8.1 Execution model

A run is a **durable state machine over an append-only event log**.

- `run_events` is the source of truth. Current state is a pure fold over events: `reduce(events) -> RunState`. Never store derived state as the primary truth; `phases` and `tasks` rows are read-model projections, rebuilt on demand.
- Each phase is an Inngest step function. Steps are idempotent and keyed, so a redeploy mid-run resumes cleanly.
- Human approval is modelled as the run entering `waiting_on_checkpoint` and the workflow sleeping on an Inngest `waitForEvent` with a deadline. Deadlines default to 72h; on expiry, behaviour depends on autonomy level.
- `seed` on the run makes all sampling, shuffling, and mock behaviour reproducible.
- **Replay**: `pnpm run:replay <runId>` re-executes the event log against the current code with all tools forced into sandbox mode, and diffs the resulting artifact set against the original. This is your regression harness for prompt changes.

### 8.2 Autonomy levels

| Level | Behaviour |
|---|---|
| `supervised` | Checkpoints at every phase boundary. Nothing is published or purchased without approval. |
| `guided` | Checkpoints only at the four **hard gates**: brand direction, offer & pricing, spend authorisation, publish. Default for new accounts. |
| `autonomous` | No blocking checkpoints. Hard gates become notifications with a 30-minute veto window before proceeding. Spend still bounded by budget envelopes. Requires a completed payment method and a signed authorisation record. |

Hard gates are declared in the playbook, not hardcoded in the runtime. `accounts.autonomy_default` seeds a new run's autonomy; `runs.autonomy` is the operative value once the run starts and may be raised or lowered mid-run by the customer, taking effect at the next phase boundary only — never retroactively unblocking a pending checkpoint.

Three distinct things are easy to conflate. Keep them separate in the code:

| Concept | Evaluated by | Blocking? | Failure behaviour |
|---|---|---|---|
| **Hard gate** | Runtime, at a declared phase boundary | Yes, unless `autonomous` (then a 30-min veto window) | Run enters `waiting_on_checkpoint` |
| **Quality gate** | Deterministic checker in `packages/quality`, before `launch` | Yes, always | Run cannot reach `live`; failures listed with the exact assertion that failed |
| **Critic rubric** | The Critic agent, per artifact | Yes, up to 3 repair cycles | After 3 rejections, escalates to a checkpoint with the critique attached |

A quality gate is never overridable by an agent. It is overridable by a human only through an explicit `quality_override` checkpoint that records who overrode it and why, and stamps the artifact `quality.overridden = true`. That flag surfaces in the UI and in the handover packet.

### 8.3 Agent definition

```ts
export interface AgentDef<I extends ZodType, O extends ZodType> {
  id: string;                    // 'strategist'
  title: string;                 // 'Strategist'
  version: string;               // semver; bump on prompt change
  model: ModelSelector;          // { tier: 'deep' | 'fast' | 'cheap' }  — resolved by gateway
  systemPrompt: (ctx: AgentContext) => string;
  input: I;
  output: O;
  tools: ToolId[];               // exhaustive allowlist; runtime rejects anything else
  maxSteps: number;              // tool-use loop cap
  maxCostMicros: number;
  rubric?: RubricId;             // which critic rubric applies to its output
  temperature: number;
}
```

Agents are pure declarations. The runtime owns the loop: build messages → call gateway → if tool calls, validate against the allowlist, execute through the tool layer, append results, repeat until final structured output or `maxSteps` → validate against `output` schema → hand to the critic if a rubric is set → write artifact.

### 8.4 Agent roster

Implement all of these in `packages/agents/`. Each gets its own directory containing `agent.ts`, `prompt.ts`, `schemas.ts`, `rubric.ts`, and `__tests__/`.

| Agent | Owns | Key outputs |
|---|---|---|
| **Interviewer** | Intake. Converts a one-liner into a complete, contradiction-free brief. Asks the minimum number of questions. | `VentureBrief` |
| **Analyst** | Demand validation, competitor teardown, channel viability, unit economics. Empowered to recommend kill. | `ValidationReport`, `UnitEconomicsModel` |
| **Strategist** | Positioning, ICP, offer architecture, price ladder, objection map, 90-day thesis. | `StrategyMemo` |
| **Brand Director** | Name candidates (with live availability), voice charter, visual direction, design tokens, mark. | `BrandSystem` |
| **Product Architect** | Catalogue / feature set / service menu. SKUs, variants, bundles, pricing. | `ProductCatalogue` |
| **Supply Officer** | Sourcing, supplier shortlists and quotes, landed cost, MOQs, lead times, fulfilment model. Physical archetype only. | `SupplyPlan` |
| **Storefront Engineer** | Builds and configures the actual commercial surface. Tool-heavy, low prose. | `StorefrontBuild` |
| **Content Studio** | Product copy, page copy, imagery briefs, email sequences, launch content. | `ContentSet` |
| **Growth Engineer** | SEO structure, channel plan, ad creative briefs, lifecycle flows, launch sequence, measurement plan. | `GrowthPlan` |
| **Compliance Officer** | Restricted-category screening, jurisdiction checklist, policy generation, claims review. Can hard-block a run. | `ComplianceReport`, `PolicySet` |
| **Critic** | Adversarial review of every rubric-bearing artifact. Rejects with diffs, never rewrites. | `CritiqueVerdict` |
| **Operator** | Post-launch daily loop: reads mirrored metrics, detects anomalies, proposes or executes next actions. | `OperatingDigest`, `ActionProposal` |

Two more, structural rather than domain:

| **Planner** | Given the brief and playbook, produces the concrete task graph for the run, including which optional phases to skip. |
| **Repair** | Invoked on task failure. Reads the error, the trace, and the artifact, and decides: retry with modified input, degrade scope, or escalate to human. |

### 8.5 Context assembly

Agents do not receive the whole run. `packages/runtime/context.ts` assembles a scoped context per invocation:
- the venture brief (always)
- named upstream artifacts declared as dependencies in the playbook
- a rolling **run memo** — a compact, agent-maintained summary of decisions and rationale, capped at ~2,000 tokens, updated via the `memo.append` tool
- relevant tool schemas
- the brand voice charter, once it exists, for any agent producing prose

Enforce a context budget per agent and log when truncation occurs.

---

## 9. Tool layer — `packages/tools`

This is what the customer is really paying for: agents that can *do things*.

### 9.1 Tool definition

```ts
export const defineTool = <I extends ZodType, O extends ZodType>(spec: {
  id: string;                       // 'shopify.product.upsert'
  version: string;
  title: string;
  description: string;              // written for the model; be precise about semantics
  scopes: Scope[];                  // ['commerce:write']
  sideEffect: 'none' | 'read' | 'write' | 'spend' | 'publish' | 'destructive';
  input: I;
  output: O;
  costEstimate?: (input: z.infer<I>) => number;   // micros
  idempotent: boolean;
  timeoutMs: number;
  retry: RetryPolicy;
  execute: (input: z.infer<I>, ctx: ToolContext) => Promise<z.infer<O>>;
  simulate: (input: z.infer<I>, ctx: ToolContext) => Promise<z.infer<O>>;  // MANDATORY
}) => Tool<I, O>;
```

`simulate` is mandatory for every tool. It returns realistic, schema-valid, seed-deterministic output without touching the network. Sandbox mode is not a debugging affordance — it is how the product runs before you have partner accounts, how tests run, and how demo runs work for prospects.

### 9.2 The invocation pipeline

Every tool call passes through, in order:

1. **Allowlist check** — is this tool in the invoking agent's declared tool list?
2. **Grant check** — does the run's `GrantSet` include the required scopes? Grants are issued at run start from the playbook's declared requirements, narrowed by the account's plan entitlements and the customer's connection state.
3. **Schema validation** of input.
4. **Sandbox routing** — if `run.sandbox` or the connector has no live credential, route to `simulate`.
5. **Approval interception** — `sideEffect` in `spend | publish | destructive` creates a checkpoint unless autonomy level or a standing authorisation covers it.
6. **Budget reservation** — reserve `costEstimate` against the envelope; release or settle after.
7. **Idempotency** — compute `hash(runId, toolId, canonicalInput)`; if a completed `tool_calls` row exists, return the stored output.
8. **Egress control** — network calls go through an allowlisted HTTP client. Blocked: private IP ranges, non-allowlisted hosts, redirects to either.
9. **Execute** with timeout and retry policy.
10. **Validate output**, persist the full `tool_calls` row, emit a `run_event`.

**Idempotency canonicalisation** must be specified exactly, because replay depends on it. Serialise input with sorted object keys, no whitespace, numbers normalised to a fixed decimal representation, `undefined` keys dropped, arrays order-preserved, and all timestamps excluded from the hash via a per-tool `idempotencyIgnore: string[]` path list. Write this once in `packages/tools/core/canonical.ts` and property-test it.

### 9.3 Spending real money

Tools with `sideEffect: 'spend'` need a pattern of their own, because the actual cost is usually unknown until an external system quotes it. Use a two-phase shape everywhere:

1. A **quote** tool (`sideEffect: 'read'`) returns a priced option set — `domain.check` returns renewal prices, `supplier.quote` returns landed cost at quantity, `ads.estimate` returns projected spend.
2. A **spend authorisation** is created from the quote: an amount ceiling, a currency, an expiry, a purpose string, and the quote's id. In `supervised` and `guided` autonomy this is a blocking checkpoint. In `autonomous` it is auto-approved if it falls inside a standing authorisation the customer signed at run start, and blocks otherwise.
3. The **commit** tool (`sideEffect: 'spend'`) accepts only an authorisation id and refuses to execute if the actual price exceeds the ceiling, if the authorisation has expired, or if the quote id does not match.

Budget envelopes are per-category (`model`, `image`, `tool`, `external`) and per-run. External spend never draws from build credits, and credits never pay for domains. Any tool that would spend outside an authorisation throws `UnauthorisedSpend` before the network call. Write a test that asserts no tool with `sideEffect: 'spend'` can execute without a matching authorisation row.

### 9.4 MCP surface — `apps/mcp`

Expose the catalogue over the Model Context Protocol so the same tools are usable by external clients (Claude Desktop, IDEs, partner agents). This costs little once the internal registry exists and gives KILN a genuine platform story.

**Scope of this prompt:** build the server, but restrict it to sandbox mode and read-only tools only. Tokens are opaque 32-byte random strings, stored hashed in a `mcp_tokens` table with `account_id`, `scopes[]`, `expires_at`, and `revoked_at`; issued from `/console`; checked on every call; rate-limited per token. Live, write-capable, and third-party-facing MCP access is prompt 2 work — do not build token exchange, OAuth, or a public directory now.

---

## 10. Tool catalogue

Implement every tool below with both `execute` and `simulate`. Group one folder per domain under `packages/tools/catalogue/`. Where a live adapter needs a partner account you do not yet have, write the live path against the documented API and leave it behind a feature flag — but the `simulate` path must be complete.

**research** — `web.search`, `web.fetch` (readability-extracted, sanitised, quarantined), `serp.analyse`, `keyword.expand`, `trend.lookup`, `competitor.teardown`, `marketplace.scan`, `review.mine` (extract complaints from public reviews — one of the highest-signal inputs for positioning).

**identity** — `name.generate`, `domain.check` (bulk, multi-TLD), `domain.register`, `handle.check` (major social platforms), `trademark.preliminaryScreen` (search only; always output as advisory, never as legal clearance).

**design** — `tokens.generate`, `logo.generate`, `mark.vectorise`, `image.generate`, `image.edit`, `image.upscale`, `image.qualityCheck`, `mockup.render` (product on-model / in-scene).

**commerce.shopify** — `store.provision`, `theme.install`, `theme.stageEdit` (never patch a live theme in place — Shopify's theme model expects whole-asset writes; always duplicate to an unpublished theme, apply asset writes there, validate, then publish atomically), `product.upsert`, `collection.upsert`, `page.upsert`, `navigation.set`, `shipping.configure`, `tax.configure`, `payments.configure`, `discount.create`, `checkout.brand`, `store.publish`, `store.transferOwnership`.

**commerce.stripe** — `product.upsert`, `price.upsert`, `paymentLink.create`, `checkoutSession.create`, `taxSettings.configure`, `connectAccount.create`.

**supply** — `supplier.search` (POD and wholesale adapters: Printful, Printify, Gelato, plus a generic wholesale adapter), `supplier.quote`, `sample.order`, `landedCost.model`, `moq.evaluate`, `fulfilment.configure`.

**site** — `site.scaffold` (generates a real Next.js or Astro site from the token set and a chosen layout archetype), `site.build`, `site.deploy`, `dns.configure`, `ssl.verify`, `redirect.set`, `lighthouse.audit`.

**content** — `copy.draft`, `copy.lint` (the slop linter as a tool), `seo.schema` (JSON-LD), `sitemap.generate`, `policy.generate`, `faq.derive`.

**comms** — `emailDomain.provision` (SPF/DKIM/DMARC), `emailList.create`, `sequence.create`, `broadcast.schedule`, `social.profileProvision`, `post.schedule`.

**booking** — `booking.provision` (Cal.com adapter plus a generic scheduling interface), `serviceMenu.publish`, `availability.set`, `bookingPage.brand`, `lead.route` (email + SMS), `quoteRequest.configure`.

**analytics** — `analytics.install`, `pixel.install`, `event.defineSchema`, `metrics.sync`, `funnel.define`.

**compliance** — `category.screen` (restricted/prohibited goods, per-jurisdiction), `claims.review` (health, financial, environmental claims), `jurisdiction.checklist`, `ageGate.configure`.

**finance** — `pnl.model`, `pricing.optimise`, `breakeven.compute`, `budget.request`.

**internal** — `artifact.write`, `artifact.read`, `memo.append`, `checkpoint.request`, `task.spawn`, `handover.prepare`, `notify.customer`.

Every tool's `description` field is model-facing prose. Write them properly: state what the tool does, what it does *not* do, what a valid input looks like, and what failure modes mean. Bad tool descriptions are the single most common cause of agent flailing.

---

## 11. Business archetypes — `packages/playbooks`

A **Playbook** is a versioned, declarative definition of how to build one kind of business. Adding a new vertical must require zero changes to the runtime.

```ts
export interface Playbook {
  id: string;                   // 'physical-shopify'
  version: string;
  archetype: Archetype;
  title: string;
  applicability: (brief: VentureBrief) => number;   // 0–1 confidence score
  phases: PhaseDef[];
  hardGates: GateDef[];
  requiredScopes: Scope[];
  requiredConnections: ProviderId[];
  qualityGates: QualityGateDef[];
  handoverManifest: HandoverItem[];
  estimatedCostMicros: number;
  estimatedDurationMinutes: number;
}

export interface PhaseDef {
  key: string;
  title: string;
  agent: AgentId;
  dependsOn: ArtifactType[];
  produces: ArtifactType[];
  optional?: (state: RunState) => boolean;
  parallelWith?: string[];
  onFailure: 'retry' | 'degrade' | 'escalate' | 'abort';
}
```

An **archetype router** scores all playbooks against the brief and picks the best; ties or low confidence produce a checkpoint asking the customer.

### 11.1 Shared phase spine

All playbooks share this backbone; each specialises the middle:

`intake → validation → strategy → identity → offer → infrastructure → build → content → compliance → qa → launch → operate`

### 11.2 `physical-shopify`

Specialises `offer` into catalogue design plus sourcing, and `build` into Shopify provisioning. Distinctives: supplier shortlisting with real quotes and landed-cost modelling; a MOQ-versus-print-on-demand decision owned by the Supply Officer, output as an explicit trade-off memo with capital requirement, margin at each volume tier, and time-to-first-sale for each option, and routed through a hard gate; product photography via generated on-model and in-scene mockups; shipping profiles by weight and zone; returns policy consistent with the fulfilment model; a first-order test purchase in the QA phase that is placed, verified, and refunded.

### 11.3 `digital-product`

Specialises `offer` into a deliverable spec and `build` into actually producing the deliverable — the template pack, the course outline and lesson scripts, the tool. This is the archetype where KILN can produce the *entire* product, not just the wrapper. Distinctives: Stripe payment links plus a delivery mechanism (gated download with signed URLs, or a lightweight members area); a lead magnet derived from the paid product; a five-email nurture sequence; a refund and licensing policy.

### 11.4 `local-service`

Specialises for geography. Distinctives: service menu with duration and pricing; booking flow (Cal.com adapter, with a simulated twin); service-area definition and local landing pages per area, generated from a real local-intent keyword set rather than spun duplicates; Google Business Profile asset pack and setup checklist; quote-request flow with lead routing to email and SMS; review-solicitation sequence.

### 11.5 Quality gates

Declared per playbook, evaluated deterministically before `launch` can proceed. A run cannot reach `live` with any gate failing. Minimum set:

- Every product/service has a unique description of 120+ words that passes slop-lint.
- Every product has at least three distinct images passing `image.qualityCheck`.
- Zero broken internal links; zero placeholder strings anywhere in deployed HTML.
- Lighthouse: performance ≥ 90, accessibility ≥ 95, SEO ≥ 95 on the three primary templates.
- Checkout completes a real test transaction end to end (sandbox or live-with-refund).
- All required policy pages exist, are reachable from the footer, and name the correct legal entity and jurisdiction.
- Email domain passes SPF, DKIM, and DMARC verification.
- Analytics fires a verified purchase event on the test transaction.
- Compliance report status is `clear` or `clear_with_conditions` and all conditions are satisfied.
- Unit economics model shows positive contribution margin at the configured price, or the customer has explicitly acknowledged a checkpoint saying otherwise.

---

## 12. Ownership, provisioning, and the credential vault

This is the commercially distinctive part of KILN and the part most likely to be built badly. Read carefully.

### 12.1 The three ownership modes

**`managed` (default).** KILN provisions and holds every external account — Shopify, domain registrar, email domain, ad accounts, Stripe — under platform-controlled organisational structures. The customer does not receive credentials. They interact with their business exclusively through KILN's own interface, which mirrors the numbers and exposes controlled write actions. This is the premium experience: one clean surface instead of nine admin panels.

**`delegated`.** The customer connects their own accounts via OAuth. KILN operates them on the customer's behalf using scoped tokens. Chosen by customers who already have a Shopify store or want direct control from day one.

**`transferred`.** A previously managed venture whose assets have been handed to the customer. Terminal state for KILN's write access unless re-delegated.

### 12.2 Non-negotiable rules for `managed` mode

The customer must always be able to leave. Build this from day one, because retrofitting it is painful and because it is what makes the model defensible rather than predatory:

1. **A standing right to handover.** The handover flow is always visible in the UI, never buried. It is not gated behind a retention conversation.
2. **A published handover SLA** — target 5 business days, executed largely automatically.
3. **Continuous export.** All data the customer would need — orders, customers, products, content, brand assets, financials — is exportable at any time as a signed ZIP, without asking anyone.
4. **Explicit disclosure at signup.** The intake flow states, in plain language, which accounts KILN will own on their behalf, what that means, and how to get them.
5. **Escrowed break-glass.** If KILN disappears, the customer can still recover. A monthly cron job builds a handover packet, encrypts it with a public key the customer generated at onboarding (KILN stores only the public half, so KILN cannot read it), writes it to object storage under a long-lived signed URL, and emails the customer the URL. For prompt 1, build the packet assembler, the key registration flow, and the encryption; wire the scheduled job and the storage lifecycle in prompt 5.

Handover mechanics, per provider, in `packages/connectors/*/handover.ts`:

- **Shopify** — collaborator/ownership transfer via store owner change; billing detached; KILN's staff accounts removed; verification that the customer can log in before marking transferred.
- **Domain** — registrar transfer with auth code, or push to a customer registrar account.
- **Stripe** — new account under customer's entity with data export; historical payouts reconciled; a documented cutover window.
- **Email/DNS** — zone transfer or record export with a step-by-step migration runbook.
- **Assets** — brand source files, fonts with license documentation, image originals, copy in Markdown, site source as a real Git repository the customer receives.

Every handover produces a `HandoverPacket` artifact and an audit trail. Write a `docs/runbooks/handover.md`.

### 12.3 Vault — `packages/vault`

- **Envelope encryption.** A per-account Data Encryption Key, itself encrypted by a Key Encryption Key held in a KMS (AWS KMS or Supabase Vault; abstract behind a `KeyProvider` interface with a local dev implementation using libsodium and a file-based key).
- **Sealed at rest, sealed in transit, decrypted only inside the tool execution boundary.** A credential's plaintext must never exist in the web app process, never in a log, never in a model prompt, never in an API response. Enforce with a lint rule banning imports of `@kiln/vault/decrypt` outside `packages/tools`.
- **Scoped leases.** `vault.lease(assetId, scopes, ttl)` returns a short-lived handle, not a secret. The HTTP client resolves handles at request time.
- **Rotation.** Every credential has `rotated_at` and a per-provider rotation policy declared in the connector (`rotation: 'supported' | 'reissue-only' | 'manual'`). A weekly job rotates what it can. Rotation is transactional: write the new credential, verify it with a cheap authenticated read, then retire the old one. If verification fails, keep the old credential active and raise a connection-health alert — never leave a venture with no working credential.
- **Expiry mid-run.** If a lease resolves to an expired or revoked credential, the tool call fails with a typed `CredentialUnavailable`, the run pauses at a `reconnect` checkpoint rather than failing, and the customer sees a single clear action: reconnect this account.
- Record the full design in `docs/adr/0004-vault-architecture.md`, including where the KEK lives in each environment, the exact decryption boundary, and the customer-initiated revocation path.
- **Full audit.** Every lease is logged with run, tool, and purpose.

### 12.4 Provisioning identity

For `managed` mode you need a defensible structure for holding assets on behalf of others. Generate `docs/adr/0003-managed-asset-custody.md` capturing: which provider ToS permit agency ownership and which do not (Shopify's Partner/agency model does; some registrars restrict it), whether KILN acts as merchant of record or agent, the KYC obligations that attach, and the per-jurisdiction entity requirements. **Flag clearly in the document that this requires review by a lawyer and an accountant before taking real customers.** The code should not pretend this is solved; it should have the abstraction ready and a checklist for the human.

---

## 13. The mirror layer — `packages/mirror`

The customer sees their business through KILN, not through Shopify. That means KILN must ingest, normalise, and present live data faithfully.

**Ingestion**, two paths per provider:
- **Webhooks** (`app/api/connectors/[provider]/webhook`) with signature verification, replay protection via an idempotency table, and ordered processing per venture.
- **Polling reconciliation** — a cron job per connection that pulls a rolling window and repairs gaps caused by missed webhooks. Never trust webhooks alone.

**Normalisation.** Every provider maps into a canonical metric vocabulary defined once in `packages/contracts/metrics.ts`: `revenue_gross`, `revenue_net`, `orders`, `units`, `aov`, `sessions`, `conversion_rate`, `cac`, `contribution_margin`, `refund_rate`, `repeat_rate`, `inventory_days`, `ad_spend`, `roas`. Provider-specific quirks (Shopify's handling of taxes, shipping, discounts, and refunds in `total_price`) are handled in the adapter, documented inline, and covered by tests with real-shaped fixtures.

**Storage.** Raw payloads to object storage for replay; normalised rows to `metric_snapshots` and `orders_mirror`. Daily rollups materialised for fast dashboards.

**Presentation.** A single venture dashboard showing yesterday's revenue, orders, and margin; a 30-day trend; the top and bottom performing products; the funnel; and — critically — **the operator digest**: three sentences of plain-language interpretation with a proposed action, generated by the Operator agent and always accompanied by the raw numbers that produced it.

**Health.** Every connection has a health record. Stale sync, auth expiry, or webhook signature failures raise a visible banner and a notification, and degrade the dashboard honestly ("last synced 4 hours ago") rather than showing stale numbers as current.

**Controlled write-back.** The customer can, from KILN's UI, do the things that matter without leaving: change a price, pause a product, edit copy, issue a refund, respond to a review, adjust a shipping rate. Each is a tool call with the same permission and audit path as an agent's. Anything not covered routes to a "request a change" flow handled by the Operator agent.

---

## 14. Payments, plans, and unit economics

### 14.1 Plans

Weekly billing, presented weekly, charged weekly via Stripe subscriptions with `interval: week`. Offer a discounted monthly and annual option.

| Plan | Price | Includes |
|---|---|---|
| **Founder** | $199/wk | 1 active venture, `guided` autonomy, 50k build credits/wk, standard model tier, community support, handover for a fee |
| **Operator** | $499/wk | 3 ventures, `autonomous` unlocked, 200k credits/wk, deep model tier, daily operator loop, paid-channel management, handover included |
| **Studio** | $1,200/wk | 10 ventures, priority execution lane, 750k credits/wk, custom playbooks, dedicated tool grants, white-glove handover, SLA |

Plus a one-time **Build Fee** option ($1,500–$5,000) for customers who want the build without the ongoing subscription — this exists mainly as a decoy that makes the weekly price look reasonable, and as a genuine option for a segment that wants it.

Entitlements live in `plans.entitlements` as structured JSON, validated by a versioned Zod schema in `packages/contracts/entitlements.ts`, and enforced in exactly one place: `packages/billing/entitlements.ts`, exposing `can(account, capability, quantity)`. Never check `plan.name === 'studio'` anywhere in the codebase. The entitlement schema is a flat, additive key space — `ventures.max`, `autonomy.max`, `credits.weekly`, `model.tier.max`, `playbooks.allowed[]`, `scopes.granted[]`, `support.tier`, `handover.included`, `lane.priority` — with a `schemaVersion` field and a migration function per version bump, so old subscriptions keep working when you change the plan lineup.

### 14.2 Metering and credits

- Build credits are the unit of AI and tool consumption. 1 credit = 1,000 micros of internal cost. Grants land in `credit_ledger` on each billing period; spend decrements.
- Overage: soft cap warns at 80%, hard cap pauses the run at 100% and surfaces a one-click top-up. Never fail silently, never continue and bill later without consent.
- **External spend** (domains, ads, samples, supplier deposits) is separate from credits and always requires an explicit spend authorisation with a stated ceiling. Charged as a Stripe invoice item with a transparent, disclosed markup or at cost — decide, disclose, and record it in the ADR.

### 14.3 Stripe integration

Implement properly, because this is where amateur builds leak money:
- Checkout for initial subscription; Customer Portal for management.
- Webhook handler that is **idempotent** (`stripe_events` table keyed on event id), verifies signatures, and processes asynchronously via the job queue rather than inline.
- Handle the full lifecycle: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.trial_will_end`.
- **Dunning**: on payment failure, ventures move to `grace` for 7 days (full access, visible banner), then `paused` (dashboards read-only, mirror sync continues, agents stop), then after 30 days a data-retention notice. Never delete a customer's business because a card expired.
- Proration on plan change; immediate entitlement change on upgrade, end-of-period on downgrade.
- Tax via Stripe Tax.
- A `billing:reconcile` nightly job asserting that KILN's `subscriptions` table matches Stripe's truth, alerting on drift.

### 14.4 Operator economics (admin console)

You need to know whether you are making money on each customer. Build `/console` with: per-run cost breakdown (model, image, tools, external), per-account weekly margin, credit burn rate versus plan price, the ten most expensive runs, cost-per-completed-venture by archetype, and a churn/expansion cohort view. If a run costs $340 in tokens against a $199 weekly plan, you must see that on day one, not month six.

---

## 15. KILN's own interface

### 15.1 Design direction

The interface should feel like a precision instrument, not a SaaS dashboard. Reference points: the density and typographic discipline of a terminal or a Bloomberg panel, softened by real editorial typography. It should look like something built by people who care, because that is the entire pitch.

**Concrete rules:**
- **Dark-first**, near-black background (`oklch(0.16 0.008 260)`), not pure black; a light mode that is genuinely designed, not inverted.
- **One accent colour**, used sparingly and with intent, defaulting to a warm signal orange (`oklch(0.72 0.17 55)`) that reads as kiln-fire. State colours are separate and muted.
- **Typography**: a grotesque with real character for UI (Söhne, Neue Haas, or the open alternative Inter Tight with tightened tracking at display sizes), a proper serif for long-form artifact reading (Source Serif, Newsreader), and a mono for data, IDs, and logs (Berkeley Mono, or JetBrains Mono). Three families, no more.
- **Spacing** on a 4px base with a deliberate rhythm; generous vertical space in reading contexts, dense in data contexts. Do not apply one padding value everywhere.
- **Borders over shadows.** Hairline `1px` dividers at low opacity. Shadows only for genuinely floating layers.
- **Motion**: 150ms for state, 250ms for layout, spring only for physical-feeling drag. Everything respects `prefers-reduced-motion`. No decorative animation.
- **Absolutely banned**: purple-blue gradients, glassmorphism, floating 3D mockups, emoji in UI chrome, generic illustration packs, "✨" anywhere, centred hero + subheading + two-button layouts on the marketing site.

Build `packages/ui` as your own primitives over Radix: `Button`, `Field`, `Select`, `Dialog`, `Sheet`, `Tabs`, `Table` (with virtualisation), `Toast`, `Tooltip`, `Command`, `Stat`, `Sparkline`, `Timeline`, `DiffView`, `StreamText`, `ArtifactCard`, `CostMeter`, `PhaseRail`. Tokens in CSS custom properties, themed at the root, consumable by both KILN's UI and the design-engine's generated brand previews.

Include a `/console/design` route rendering every component in every state. Screenshot-test it with Playwright.

### 15.2 Surfaces

**Marketing site.** Must sell a $500/week product. Lead with a real, unedited recorded build — a video or an interactive replay of an actual run, showing the store that came out the other end. Show three real ventures with live URLs and real numbers. Pricing is stated plainly with no "contact us". Include an honest limitations section; it converts better than hype at this price point and it is true.

**Intake.** A wizard that feels like a conversation with a sharp consultant, not a form. Structured steps with a free-text field at each, the Interviewer agent reading between the lines and pre-filling, and a visible "brief" panel on the right that assembles in real time as the customer talks. End on a plan preview: what will be built, estimated duration, estimated cost, which gates apply.

**Run Theatre** (`/runs/[runId]`) — the centrepiece. See §16.

**Venture dashboard.** The mirror layer's output. Yesterday's numbers at the top, the operator digest below, then trends, then products, then the action queue.

**Artifact library.** Every artifact, versioned, diffable, with a reading view that respects the serif and a raw JSON view for the technically inclined. Regenerate-with-instruction on any artifact.

**Approvals.** A queue of pending checkpoints with enough context to decide in under a minute: what is being asked, what the agent recommends, what the alternatives are, what happens if you do nothing.

**Handover.** Always accessible. Shows every asset, its ownership mode, and a one-click start.

**Console.** Operator-only. Runs, costs, margins, incidents, connector health, model spend, fixture coverage.

---

## 16. Run Theatre

If one screen decides whether KILN feels worth hundreds a week, this is it. Watching your business get built is the product experience.

Layout: a left **phase rail** showing the full pipeline with states; a centre **stream**; a right **artifact panel**.

The stream is a chronological feed of typed events rendered as distinct components, not a wall of text:
- **Agent thinking** — streaming prose, collapsed to two lines after completion, expandable.
- **Tool call** — a compact card: tool name in mono, key inputs, a live spinner, then result summary, latency, and cost. Expandable to full input/output JSON.
- **Artifact created** — an inline preview that mounts in the right panel. A brand system shows swatches and type specimens. A storefront build shows a live iframe. A strategy memo shows formatted prose.
- **Critic verdict** — visibly distinct, showing the rubric scores and, when rejected, the specific diff being sent back. Do not hide rejections; showing the system criticising itself is a trust-builder and a differentiator.
- **Checkpoint** — an inline decision card, blocking, with the recommendation pre-selected.
- **Spend** — an explicit line item every time real money moves.

Persistent chrome: a **cost meter** showing credits burned versus budget, elapsed time versus estimate, and an **intervention bar** — a text field where the customer can inject an instruction at any time ("make the packaging brief less minimal", "drop the third product"), which is captured as a `human_directive` event, routed to the Planner, and either applied to the current phase or queued for the next.

Technical requirements: SSE for token streaming, Supabase Realtime for structural events, full state reconstruction on reload from the event log, graceful reconnect with gap-fill by sequence number, and an ambient audio option (off by default, tasteful, one soft tone per phase completion). Runs are replayable after the fact at 1x/4x/16x — this doubles as the marketing asset.

---

## 17. Observability, traces, and evals

- **OpenTelemetry** spans across the whole run tree: run → phase → task → agent invocation → tool call. Trace ids surfaced in the console.
- **Run trace viewer** in `/console`: a flame graph of a run with cost overlaid on duration.
- **Structured logging** with `pino`, redaction enabled, correlation ids everywhere.
- **Eval harness** in `tests/evals`. Golden runs for all three archetypes, stored as fixture sets. On every prompt or agent-version change, CI replays the golden runs in sandbox mode and reports: quality gate pass rate, critic scores, cost delta, duration delta, and artifact diffs. A regression in any is a failing build.
- **Slop regression test**: a corpus of known-bad copy the linter must catch, and a corpus of known-good human copy it must *not* flag. Track false-positive rate; a linter that blocks good writing is worse than none.
- **Alerts**: run failure rate, checkpoint expiry rate, connector health, model error rate, cost-per-run p95, Stripe webhook lag.

---

## 18. Security and safety

- **Tenant isolation** via RLS on every table, plus an application-layer `assertAccountAccess` guard. Test cross-tenant access explicitly.
- **Prompt injection defence.** Web-fetched content is wrapped in `<untrusted_content>` delimiters, has instruction-like patterns neutralised, and the system prompt states unambiguously that content inside those delimiters is data. Tool calls originating within one turn after untrusted content ingestion and targeting `spend`/`publish`/`destructive` effects require an extra confirmation step. Log any detected injection attempt.
- **Egress allowlist** for all outbound HTTP from tools. Block private ranges, cloud metadata endpoints, and redirect chains that escape the allowlist.
- **No arbitrary code execution** by agents in prompt 1. If you later add a code-execution tool (prompt 4 candidate), it runs in an ephemeral, network-restricted container with a filesystem quota and a hard timeout.
- **Secrets** never in prompts, logs, artifacts, error messages, or client bundles. Add a CI check scanning build output for high-entropy strings.
- **Rate limits** per account and per IP on all mutating endpoints, backed by Redis or Postgres.
- **Content safety.** The Compliance Officer screens for restricted categories before any build proceeds: regulated goods, medical/financial claims, adult content, weapons, controlled substances, MLM structures, dropshipping of counterfeits. Maintain the list in `packages/tools/catalogue/compliance/restricted.ts` with jurisdiction annotations. A hard block produces a clear explanation and a refund path, not a vague error.
- **Abuse.** KILN can be used to spin up fraudulent stores at scale. Implement: KYC on the paying account before any `publish`-effect tool runs live, velocity limits on venture creation, a manual review queue for flagged categories, and a takedown procedure documented in `docs/runbooks/abuse.md`.
- **Data.** Retention policy per data class; deletion request flow that actually cascades; customer data export; a documented sub-processor list.

---

## 19. Testing

- **Unit** (Vitest): every Zod schema round-trips; every tool's `simulate` satisfies its output schema under fuzzed input; the event-log fold is pure and total; entitlement logic is table-driven with exhaustive cases; the slop linter against its corpora.
- **Integration** (Testcontainers + real Postgres): migrations apply cleanly forward; RLS policies enforce isolation; the job queue is idempotent under duplicate delivery; the Stripe webhook handler is idempotent under replay.
- **Runtime**: a full sandboxed run per archetype completes, produces every declared artifact, passes every quality gate, and costs zero real money. Kill the process mid-run and assert clean resumption.
- **E2E** (Playwright): signup → intake → run start → watch theatre → approve a checkpoint → reach `live` → view dashboard → export → start handover. Also: card decline → grace → pause → recovery.
- **Visual**: Playwright screenshots of the design gallery and of three generated brand previews, diffed against baselines.
- **Load**: 50 concurrent runs in sandbox mode without queue starvation or DB connection exhaustion.

Coverage target 80% on `packages/runtime`, `packages/tools/core`, `packages/billing`, `packages/vault`. Do not chase coverage on UI.

---

## 20. Environment

Write `.env.example` with every variable, grouped, commented, and with the AI keys **blank**. Parse it through Zod in `packages/config/env.ts` and fail fast at boot with a readable error listing every missing required variable.

```bash
# ── Core ────────────────────────────────────────────────
NODE_ENV=development
APP_URL=http://localhost:3000
ENCRYPTION_MASTER_KEY=            # generate: openssl rand -base64 32

# ── AI provider (INTENTIONALLY BLANK — mock provider runs without these) ──
MODEL_PROVIDER=mock               # mock | kimi | deepseek
MODEL_FALLBACK_ORDER=mock
MODEL_RECORD=0                    # 1 = record real responses into fixtures/

KIMI_API_KEY=
KIMI_BASE_URL=https://api.moonshot.ai/v1
KIMI_MODEL_DEEP=
KIMI_MODEL_FAST=

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL_DEEP=
DEEPSEEK_MODEL_FAST=

# ── Data ────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kiln
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ── Jobs ────────────────────────────────────────────────
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
REDIS_URL=redis://localhost:6379

# ── Payments ────────────────────────────────────────────
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PUBLISHABLE_KEY=

# ── Connectors (all optional; each falls back to simulate) ──
SHOPIFY_PARTNER_TOKEN=
SHOPIFY_APP_KEY=
SHOPIFY_APP_SECRET=
VERCEL_TOKEN=
CLOUDFLARE_API_TOKEN=
NAMECHEAP_API_KEY=
RESEND_API_KEY=
PRINTFUL_API_KEY=
SEARCH_API_KEY=
IMAGE_API_KEY=

# ── Flags ───────────────────────────────────────────────
SANDBOX_MODE=1                    # 1 = all tools simulate, regardless of keys
DEMO_MODE=1                       # seeds a completed venture for prospects
ENABLE_MCP_SERVER=1
```

`SANDBOX_MODE=1` and `MODEL_PROVIDER=mock` are the defaults. The application must be fully explorable in that state.

---

## 21. Local bootstrap

`pnpm bootstrap` must, from a fresh clone with nothing but Node and Docker:

1. Start Postgres, Redis, and MinIO via `docker-compose`.
2. Apply migrations and RLS policies.
3. Seed: three plans, one demo account, one **completed** venture per archetype with full artifact sets and 90 days of realistic mirrored metrics, and one **paused mid-run** venture sitting at a checkpoint so the theatre and approvals UI have real content immediately.
4. Start web, worker, and MCP server.
5. Print a short table of URLs and the demo login.

Also provide `pnpm demo:run` which kicks off a complete sandboxed build of a seeded idea, streaming into the theatre, finishing in roughly 90 seconds of accelerated time. This is your sales demo and your smoke test in one.

---

## 22. Definition of done for this prompt

Do not report completion until every one of these is true:

1. `pnpm bootstrap` succeeds on a clean machine with an unmodified `.env.example` copied to `.env`, and no AI or connector keys.
2. `pnpm demo:run` completes a full `physical-shopify` run in sandbox mode, producing every artifact the playbook declares and passing every quality gate.
3. The Run Theatre streams that run live, and reloading mid-run reconstructs identical state from the event log.
4. All three playbooks are registered, routable, and complete in sandbox mode.
5. Every tool in §10 exists with a working `simulate`; every one has a schema test.
6. `pnpm typecheck` and `pnpm lint` are clean. Zero `any` in `packages/`.
7. `pnpm test` passes, including the RLS isolation test and the slop-linter corpora.
8. Stripe subscription checkout and an idempotent webhook handler work against Stripe test mode if a key is present, and against a simulated adapter if not. Dunning, proration, and metering are prompt 3; stub them behind clearly marked interfaces.
9. The design gallery renders every primitive; visual baselines are committed.
10. `docs/` contains ADRs 0001–0005 (stack choice, agent runtime vs framework, managed asset custody, vault architecture, sandbox-first architecture), plus the handover runbook. The abuse runbook may be a stub with its headings.
11. Setting `MODEL_PROVIDER=kimi` and adding a key switches to live inference with **zero code changes** — verified by a test that asserts no provider-specific branching exists outside `packages/model-gateway`.
12. The spend-authorisation path is enforced: a test proves no `spend`-effect tool can execute without a matching authorisation.

**Deliberately out of scope for this prompt**, even though the architecture must accommodate them: any live third-party write, MCP write access, dunning and metering, the mirror layer's real ingestion, the escrow cron, KYC, and OpenTelemetry export to a hosted backend (console exporter is enough). Stub each behind the interface it will eventually implement, with a `// TODO(prompt-N)` header. A stub that satisfies the interface and a passing `simulate` is acceptable; a missing interface is not.

---

## 23. Explicit anti-patterns

Do not do any of these. Each is a real failure mode for this kind of build.

- Do not use an agent framework. Do not add LangChain "just for the parsers".
- Do not let an agent construct a URL and fetch it directly. Tools only.
- Do not store derived run state as truth. The event log is truth.
- Do not put business logic in React components or Next.js route handlers. Routes call services; services own logic.
- Do not write one 3,000-line `orchestrator.ts`. Split by concern.
- Do not hardcode a model name outside config.
- Do not create a `utils.ts` junk drawer.
- Do not ship the shadcn default theme.
- Do not generate marketing copy with the same agent that generates strategy — different temperature, different rubric, different prompt.
- Do not let the critic rewrite. It rejects and instructs only.
- Do not implement retry as `catch { retry() }` without backoff, jitter, and a cap.
- Do not skip `simulate` on "simple" tools. Every tool, no exceptions.
- Do not silently degrade quality when a provider fails. Mark the artifact and tell the customer.
- Do not build the handover flow "later".
- Do not use floats for money.
- Do not write comments that restate the code. Comment *why*, and only where it is genuinely non-obvious.

---

## 24. What comes after this prompt

Build **prompt 1** to the definition of done in §22. That is: monorepo, schema and RLS, config and env, model gateway with all three adapters, the runtime and event log, the tool core plus every tool's `simulate`, all three playbooks, the quality layer, the design system, the Run Theatre, intake, and the bootstrap/demo path. Live connector adapters may be stubbed behind flags; sandbox paths may not.

The remaining four prompts, in order, each assuming the previous is complete and green:

**Prompt 2 — Live integrations.** Real Shopify Partner provisioning and full store build, real domain registration and DNS, Vercel deploys, Resend email domain authentication with SPF/DKIM/DMARC verification, real search and image generation adapters, Printful/Printify sourcing, Cal.com booking. Every live path must pass the same tests its `simulate` twin passes. Add the record-mode fixture capture so the mock corpus fills from real traffic.

**Prompt 3 — Billing, entitlements, and the operator console.** Full Stripe lifecycle, dunning, credits and metering with hard caps, external spend authorisation, the reconciliation job, and the margin console. Add KYC gating before live publish.

**Prompt 4 — The mirror and the operating loop.** Webhook ingestion and polling reconciliation for every connector, canonical metric normalisation, rollups, the venture dashboard, the Operator agent's daily digest and action proposals, controlled write-back actions, connection health, and alerting. This is what converts a one-time build into a weekly subscription, so give it real attention.

**Prompt 5 — Handover, hardening, and launch.** The complete handover flow per provider with escrow snapshots, the abuse and takedown pipeline, data export and deletion, load and chaos testing, the marketing site with real recorded runs, onboarding, and production deployment with runbooks.

Begin with prompt 1. Work through the repository layout in §5 in dependency order — `contracts`, `config`, `db`, `model-gateway`, `tools/core`, `runtime`, `agents`, `tools/catalogue`, `playbooks`, `quality`, `design-engine`, `ui`, then `apps/web` and `apps/worker`. Commit in coherent, reviewable slices with real commit messages. When a decision is genuinely ambiguous, pick the option that keeps the sandbox path working and record the trade-off in an ADR rather than stopping to ask.

=== END PROMPT ===

