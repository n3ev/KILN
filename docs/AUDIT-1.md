# KILN — Prompt 1 Audit

**Audited:** 2026-08-02
**Auditor:** fresh session, no reuse of the build session.
**Repo state:** `master`, **zero commits** (`git log` → `fatal: your current branch 'master' does not have any commits yet`). Everything below was audited against the working tree.

## Preliminary: the spec is not in this repository

The audit brief said the spec was in the repo, "likely `docs/SPEC.md`". It is not:

```
$ ls CLAUDE.md docs/SPEC.md
ls: cannot access 'CLAUDE.md': No such file or directory
ls: cannot access 'docs/SPEC.md': No such file or directory
```

I located it outside the repo, at
`~/.config/Claude/local-agent-mode-sessions/.../outputs/KILN-one-shot-build-prompt.md` (913 lines; §22 at line 852). All §-references below are to that file.

This matters more than a missing file usually would, because **50 source comments cite `CLAUDE.md` §-numbers as normative** (`packages/tools/core/pipeline.ts:17` → "CLAUDE.md §9.2"; `packages/db/__tests__/rls.test.ts:12` → "CLAUDE.md §6.1"; `packages/design-engine/type-pairings.ts:4` → "CLAUDE.md §3.4 requires at least 24 real…"). The document those 50 comments point at does not exist in the tree. See Deviations.

**Environment note.** `pnpm` was not on `PATH`; Node 20 was default while the repo requires ≥22. I ran everything under `~/.nvm/versions/node/v22.23.2/bin` with corepack-activated pnpm 9.15.4. **Docker is not installed on this machine** (`docker: command not found`), which is the binding constraint on criterion 1.

---

## 1. Definition-of-done table

| # | Criterion (restated) | Verdict | Command | Evidence |
|---|---|---|---|---|
| 1 | `pnpm bootstrap` succeeds on a clean machine, unmodified `.env.example`, no keys | **UNVERIFIED** | `KILN_BOOTSTRAP_NO_START=1 pnpm bootstrap` | Exited 0. `diff .env .env.example` → identical, so the "no keys" condition genuinely held. Migrations applied (5 migrations, 4 policy files), seed ran ("Seeded demo@kiln.local with three completed ventures and one pending approval"), URL table printed. **But Docker is absent**, so the script took its fallback branch and printed `Docker is unavailable; using embedded Postgres and starting the web process only`. §21 steps 1 (Postgres/Redis/MinIO via docker-compose) and 4 (web + worker + MCP) were never exercised. Fallback path passes; the spec'd path is untested here. |
| 2 | `pnpm demo:run` completes a full `physical-shopify` run in sandbox, every artifact, every quality gate | **PASS** | `pnpm demo:run` | `Worker demo succeeded: fb9403b7-…` / `Artifacts: 15; checkpoints: 4; events: 1440; streamed tokens: 1282; model ledger: 32; quality cleared: true`. Self-verifying: `demo.ts:137` fails on any missing declared artifact, `:140` on `clearedForLaunch === false`, `:141` if persisted hard gates < `physicalShopify.hardGates.length`. Reproduced 4×. |
| 3 | Run Theatre streams live; reloading **mid-run** reconstructs identical state | **UNVERIFIED** | `npx playwright test` | The committed e2e covers a **completed** run: "a completed run reconstructs identically…" passed — it snapshots `.k-phase`/`.k-event-card`/`.k-artifact-card`, calls `page.reload()`, asserts equality. No test reloads **mid-run**, which is what the criterion says. The one e2e that would have driven a live run is disabled: `kiln.spec.ts:51 test.fixme(true, "Embedded PGlite runs web-only, and run success currently does not project the newly created venture from building to live.")`. `theatre-state.test.ts` covers replay *timing* only (2 tests), not reconstruction identity. |
| 4 | All three playbooks registered, routable, complete in sandbox | **PASS** | `npx vitest run tests/evals/golden-runs.test.ts` | 3/3: `physical-shopify` 101ms, `digital-product` 51ms, `local-service` 49ms — each "remains complete, deterministic, and launch-clear". Caveat: golden runs drive `runPlaybook` with in-memory deps; only `physical-shopify` is exercised end-to-end through the Postgres executor (via `demo:run`). |
| 5 | Every §10 tool exists with working `simulate`; every one has a schema test | **PASS** | registry probe + `npx vitest run packages/tools/catalogue/__tests__/catalogue.test.ts` | 92 tools registered; `missing simulate: none`, `missing execute: none`. Catalogue test iterates `ALL_TOOLS`, synthesising 3 inputs each, asserting output-schema validity **and** determinism. 3/3 passed. Spec-vs-code diff in §3 below: **0 missing**. |
| 6 | `pnpm typecheck` and `pnpm lint` clean; zero `any` in `packages/` | **PASS** | `pnpm typecheck --force`, `pnpm lint` | Typecheck: `Tasks: 21 successful, 21 total / Cached: 0 cached` — I forced cache bypass because the first run was 21/21 turbo cache hits and proved nothing. Lint exit 0: "no explicit any, vault leak, direct tool fetch, hardcoded model, or oversized module." Independent grep for `any` in `packages/` returned 17 hits, **all the English word in prose** (e.g. `"…before any stock exists"`), zero type positions. |
| 7 | `pnpm test` passes, incl. RLS isolation test and slop-linter corpora | **PASS** | `pnpm test`; targeted reruns | `Test Files 54 passed (54) / Tests 456 passed (456)`. RLS verified in isolation: 18/18, including "cannot read another tenant's account", "cannot write a venture into another tenant's account", and — notably — "actually drops out of superuser, or the rest of this file proves nothing". Corpora genuinely loaded from `fixtures/slop/{known-bad,known-good}.json` by `corpora.test.ts`; quality suite 27/27. |
| 8 | Stripe checkout + idempotent webhook (test mode if key, simulated adapter if not); dunning/proration/metering stubbed behind marked interfaces | **PASS** | `npx vitest run packages/billing` | Adapter tests pass incl. "verifies mock webhooks and rejects tampering", "creates a weekly Stripe subscription with automatic tax", "surfaces Stripe errors and refuses sessions without a URL". Idempotency is real: `webhook.test.ts:41` "deduplicates replay and processes the queued event once" (`first.replayed=false`, `replay.replayed=true`, same `jobId`); key is `stripe:${event.id}` (`service.ts:111`). Deferred policy is inert behind `BillingLifecycleHooks` with a `TODO(prompt-3)` header. |
| 9 | Design gallery renders **every** primitive; visual baselines committed | **FAIL** | `npx playwright test` | Two independent failures. (a) The committed baseline does not reproduce on its own platform: `1 failed — design gallery renders the primitive visual baseline`, `970 pixels (ratio 0.01 of all image pixels) are different`. Baseline is `design-gallery-chromium-linux.png` and the run was chromium/linux, so this is not a platform mismatch. (b) Coverage is incomplete: 25 primitives are exported from `packages/ui`, 23 appear in the gallery. **`Empty` and `StalenessBanner` are never rendered.** |
| 10 | `docs/` has ADRs 0001–0005 + handover runbook; abuse runbook may be a stub with headings | **PASS** | `ls docs/adr docs/runbooks` | 0001 stack choice (47 ln), 0002 agent runtime vs framework (43), 0003 managed asset custody (67), 0004 vault architecture (74), 0005 sandbox-first (46). `runbooks/handover.md` 147 ln. `runbooks/abuse.md` 84 ln with 8 real headings — exceeds the "headings only" allowance. |
| 11 | `MODEL_PROVIDER=kimi` + key → live inference, zero code changes; test asserts no provider branching outside `packages/model-gateway` | **PASS** | `npx vitest run packages/model-gateway`; config probe | Test "keeps provider-specific names out of production branching above the gateway" passes — it walks `packages/` and `apps/`, excluding `model-gateway`, `config`, and `__tests__`, and asserts **zero** files match `/\b(kimi\|deepseek)\b/i`. Empirically confirmed the switch: `MODEL_PROVIDER=kimi` alone → `availableProviders: [ 'mock' ]`; adding `KIMI_API_KEY=…` → `availableProviders: [ 'kimi', 'mock' ]`, no code edited. |
| 12 | Spend-authorisation enforced; a test proves no `spend`-effect tool runs without a matching authorisation | **PASS** | `npx vitest run packages/tools/core/__tests__/pipeline.test.ts` | 6/6 pass: "refuses every spend-effect tool without an authorisation" (rejects with `UnauthorisedSpend`, and asserts `records` is empty so nothing executed), plus wrong-run rejection, consumed one-shot rejection, ceiling reservation, and forced re-confirmation after untrusted content. Enforcement is structural in `invokeTool` (`pipeline.ts:273`), so it covers every tool routed through the pipeline. See the caveat in §4. |

**Score: 9 PASS, 1 FAIL, 2 UNVERIFIED.**

### §22 out-of-scope list — did the build wander into prompt 2–5?

No. Checked each:

- **Live third-party writes** — `packages/connectors/live.ts` is stubs only; every method throws `LiveConnectorUnavailable`. Worker egress is closed off entirely: `run-adapter.ts:198` gives tools an `http.fetch` that throws `"Direct worker egress is disabled"`, and `lease` throws rather than handing out credentials.
- **MCP write access** — `apps/mcp/src/server.ts:80` calls `tool.simulate(...)`. There is no `execute` path in the MCP server.
- **Dunning / proration / metering** — `promptOneLifecycleHooks` are four empty async functions behind a typed interface.
- **Mirror real ingestion** — `MirrorReconciler` coordinates polling/persistence but delegates to connectors, whose live `reconcile` throws (`prompt-4`).
- **Escrow cron** — `LiveEscrowSchedulerStub.schedule` throws (`prompt-5`). Assembly/encryption ship in prompt 1, scheduling does not.
- **KYC** — no verification provider is integrated. What exists is the *gate*: `livePublishBlockReason` (`apps/worker/tool-policy.ts:79`) blocks live publish on `kyc-required`/`kyc-rejected`/`manual-review`. This is the conservative direction (blocks rather than permits), so it does not constitute wandering.
- **OTel hosted export** — no exporter; `packages/observability/tracing.ts` logs to console. Consistent with "console exporter is enough". See Deviations for the OTel-SDK question.

---

## 2. Stub inventory

Only **three files** carry a `TODO(prompt-N)` marker. All three are properly typed — none is an empty shell.

| Path | Defers to | Interface fully typed & exported? |
|---|---|---|
| `packages/connectors/live.ts` | prompt-2 (provisioning, credential rotation), prompt-4 (polling, webhook normalisation, reconciliation), prompt-5 (escrow storage/delivery) | **Yes.** `LiveConnectorStub implements Connector`; `LiveEscrowSchedulerStub implements EscrowScheduler`. Both interfaces exported from `packages/connectors/types.ts` with full zod-inferred payload types. Methods throw a typed `LiveConnectorUnavailable` carrying the target prompt number — not `undefined`, not silent. |
| `packages/billing/lifecycle.ts` | prompt-3 (dunning timers, proration, metered credit grants, notifications) | **Yes.** `BillingLifecycleHooks` exported with four `(event: StripeEvent) => Promise<void>` members; `promptOneLifecycleHooks` is a complete, inert implementation. |
| `apps/worker/run-adapter.ts` | prompt-2 (live connector leases, worker egress) | **Yes** — but these are two inline throwing closures inside the `ToolContext` factory (`:196`, `:198`), not a named interface. The interface they satisfy (`ToolContext.lease`, `ToolContext.http`) is fully typed in `packages/tools/core/define.ts:47-49`. Satisfies its interface; does not introduce one. |

### Deferred areas with an interface but **no** `TODO(prompt-N)` header

§22 requires each out-of-scope item be stubbed "behind the interface it will eventually implement, with a `// TODO(prompt-N)` header". These have the interface but not the marker — the *letter* of the rule is unmet, though nothing is missing structurally:

| Area | Interface | Marker present? |
|---|---|---|
| Mirror ingestion (prompt-4) | `MirrorStore` (`loadConnection`/`persistBatch`/`markFailure`), `MirrorReconciler`, `PostgresMirrorStore` — all exported and typed | **No** `TODO(prompt-4)` anywhere in `packages/mirror/`. The marker lives in `connectors/live.ts` instead. |
| MCP write access (prompt-2) | `apps/mcp/src/server.ts` simulate-only | **No** marker explaining why `execute` is absent. |

**No empty shells found.** Every stub I opened satisfies a real, exported, typed interface.

---

## 3. Tool catalogue coverage

92 tools registered. Enumerated by importing `buildRegistry()` rather than grepping, so this reflects what the runtime actually sees.

| Metric | Count |
|---|---|
| Tools in `packages/tools/catalogue/` | **92** |
| With `simulate` | **92** (missing: none) |
| With `execute` | **92** (missing: none) |
| Covered by a schema test | **92** — `catalogue.test.ts` iterates `ALL_TOOLS`, 3 synthesised inputs each, asserting output-schema validity **and** determinism |
| Schema test passing | **Yes** — 3/3, incl. "returns schema-valid, deterministic simulations for every tool" |

Rather than reproduce 92 near-identical rows, the per-tool result is uniform: **every** tool has `simulate`, `execute`, and passing schema+determinism coverage. Domain breakdown: research 8, identity 5, design 8, commerce.shopify 14, commerce.stripe 6, supply 6, site 7, content 6, comms 6, booking 6, analytics 5, compliance 4, finance 4, internal 7.

### Cross-reference against §10

**Tools named in §10 that do not exist in code: 0.**

The mechanical diff first reported 19 "missing", but all 19 are namespace-prefixed in code:

| §10 name | Implemented as |
|---|---|
| `store.provision`, `theme.install`, `theme.stageEdit`, `product.upsert`, `collection.upsert`, `page.upsert`, `navigation.set`, `shipping.configure`, `tax.configure`, `payments.configure`, `discount.create`, `checkout.brand`, `store.publish`, `store.transferOwnership` | `shopify.*` (14) |
| `product.upsert`, `price.upsert`, `paymentLink.create`, `checkoutSession.create`, `taxSettings.configure`, `connectAccount.create` | `stripe.*` (6) |

§10 lists 92 tool names across its domains, which collapse to **91 unique ids** because `product.upsert` appears under both `commerce.shopify` and `commerce.stripe`. The namespacing resolves that genuine collision and yields 92 distinct ids. This is a sound deviation, not a gap.

**Weak guard worth noting:** `catalogue.test.ts:24` ("contains every prompt-1 tool and no duplicate ids") asserts `arrayContaining` over just **9 hand-picked ids**. It verifies uniqueness across the whole set, but a tool could be deleted from the catalogue and this test would still pass unless it were one of those 9. The roster is not pinned.

---

## 4. Contract violations

| Check | Count | Detail |
|---|---|---|
| `any` in `packages/` | **0** | Grep returned 17 word-boundary hits; every one is the English word inside prose (tool descriptions, agent prompts, rubric text) — e.g. `packages/agents/prompt.ts:75` "…or call APIs any". Zero type positions. Confirmed independently by the AST-based lint (`scripts/lint.ts:44`). |
| Placeholder residue (`lorem`, `[insert`, `example.com`, `Your Brand`) | **0 in shipped output** | 12 raw hits, all legitimate: 5 are the slop-linter's own detection regexes (`packages/quality/slop-lint/rules.ts:233-240`), 4 are its test fixtures, 2 are redaction-test inputs. The 12th, `packages/tools/catalogue/comms/index.ts:16`, is explanatory prose in a model-facing description ("a subdomain such as mail.example.com") — didactic, not residue. |
| Vault decryption imported outside `packages/tools` | **1** | `apps/worker/bootstrap.ts:13` — `import { rotate as rotateCredential } from "@kiln/vault"`. This is credential *rotation* in the worker, which is where ADR 0004 puts it, so it is architecturally intended. Flagged because `scripts/lint.ts:50` only forbids the import in `apps/web/`, so the boundary is narrower than the audit brief's phrasing implies. No decryption path reaches the web process — separately enforced by a `package.json` dependency check (`lint.ts:94`). |
| Provider-specific branching outside `packages/model-gateway` | **0 branching** | 6 hits, none of which is branching: `packages/config/env.ts:60` is the `ProviderId` enum (a registry, and the seam the switch depends on); the other 5 are test fixture values. The dedicated test at `gateway.test.ts:51` proves zero non-test, non-config files mention `kimi`/`deepseek`. |
| Float/number for a currency amount | **0** | 2 candidates, both false positives. `packages/tools/catalogue/finance/index.ts:47` — `compute(price, cost, ads)` receives `*Micros` integers and uses `Math.round` for fee arithmetic; the only float it returns is `contributionMarginPct`, a percentage. `packages/contracts/errors.ts:281` — `budget: number` on `ContextOverflow` is a **token** budget, not money. No `z.number()` without `.int()` on any money-named field. |
| Files over 400 lines | **0** | Across all hand-authored `.ts`/`.tsx` in `apps/` and `packages/`. Enforced in CI by `lint.ts:33`. |

**Caveat on criterion 12's proof.** The test named "refuses **every** spend-effect tool without an authorisation" exercises a single fixture tool (`spendTool`), not the catalogue's two real spend-effect tools (`packages/tools/catalogue/identity/index.ts:135`, `packages/tools/catalogue/supply/index.ts:197`). The guarantee still holds — it is enforced structurally in `invokeTool`, which every tool call routes through — but the test name overstates what it enumerates.

---

## 5. Runtime reality check

Each of these was executed, not reasoned about.

### 5.1 Kill `demo:run` mid-run, restart — does it resume from the event log?

**Two different answers, and the distinction matters.**

*Literally as asked:* **No.** `demo.ts:46` mints `const runId = randomUUID()` on every invocation. Killing and re-running `pnpm demo:run` starts a brand-new run; it never looks for the interrupted one. Confirmed across four invocations, each producing a distinct run id.

*The underlying capability:* **Yes, and it works.** Getting a genuine interruption took three attempts — the run completes in 2.9s, and `kill -9` on the `tsx` wrapper leaves the node child alive. I slowed it with `MOCK_STREAM_JITTER_MS=8` and killed the process tree at 6s:

```
--- snapshot of most recent run ---
{ "id": "e9272209-…", "status": "running", "events": 61, "artifacts": 0, "checkpoints": 0 }
```

Re-executing **that same run id** through `PostgresRunExecutor`:

```
BEFORE RESUME:   {"status":"running","events":61,"artifacts":0,"checkpoints":0}
EXECUTOR RESULT: {"status":"succeeded","artifacts":15}
AFTER RESUME:    {"status":"succeeded","events":1602,"artifacts":15,"checkpoints":4}
```

It resumed from the event log (`store.loadState()`, `run-adapter.ts:95`) and drove the run to completion — 15 artifacts, not 30, so no duplicated work. Resume is at **phase granularity**: 1602 final events vs ~1471–1503 for a clean run, i.e. the in-flight phase was redone. That is the correct trade-off, not a defect. Terminal and paused runs short-circuit correctly (`:103`, `:106`).

So the machinery is sound and the demo script simply does not use it. In production the job queue re-dispatches by run id, which is the path that matters.

### 5.2 Reload the Run Theatre mid-run — is state reconstructed identically?

**UNVERIFIED.** No test does this, and I could not construct it: the theatre requires the web app, and the e2e that drives a live run through the worker is disabled (`kiln.spec.ts:51`, `test.fixme`) precisely because "Embedded PGlite runs web-only". What *is* proven is reload of a **completed** run — that e2e passes, comparing phase text, event-card count, and artifact-card count across `page.reload()`. Mid-run reconstruction, which is what §22.3 asks for, is untested.

### 5.3 `sideEffect: 'spend'` with no authorisation row — does it throw `UnauthorisedSpend`?

**Yes.** `refuses every spend-effect tool without an authorisation` passes: rejects with `UnauthorisedSpend` and asserts `records` is empty, so the tool never executed. Five further spend tests pass (foreign-run authorisation, consumed one-shot, expired, ceiling exceeded, quote mismatch). `pipeline.ts:273`: `if (!args.authorisationId) throw new UnauthorisedSpend(tool.id, "missing")`.

### 5.4 RLS isolation — does a cross-tenant read actually fail?

**Yes.** 18/18 passed. The suite is unusually careful: its first test asserts it actually dropped out of superuser ("or the rest of this file proves nothing"), checking `rolsuper = false` via `pg_roles`, because Postgres bypasses RLS for superusers and table owners. Cross-tenant reads return **0 rows**; cross-tenant writes are **rejected** with a `row-level security` error. It also proves service-role forgery via a custom GUC fails, and that `SECURITY DEFINER` helpers stay tenant-scoped even when owned by `service_role`. The append-only event log rejects `UPDATE` and `DELETE` **even as superuser**.

One caveat: this runs against **embedded PGlite**, not the docker-compose Postgres. Same policy SQL (`applySchema()` applies `policies/0001-0004`), but the production engine path is unexercised here.

### 5.5 Do all three playbooks complete in sandbox, or only one?

**All three.** `golden-runs.test.ts` 3/3 — `physical-shopify`, `digital-product`, `local-service`, each asserted complete, deterministic, and launch-clear against a committed fixture. Qualifier: all three complete through the **in-memory** orchestrator; only `physical-shopify` is proven through the DB-backed `PostgresRunExecutor`.

### 5.6 Full e2e suite (run for criteria 3 and 9)

```
1 failed
  [chromium] › kiln.spec.ts:113:1 › design gallery renders the primitive visual baseline
4 skipped
9 passed (37.5s)
```

The 4 skips are permanent `test.fixme(true, …)`, each documenting a real gap:

| Line | Admission |
|---|---|
| 31 | "The auth route currently documents offline bypass; it has no signup form or wired Supabase Auth bridge." |
| 51 | "…run success currently does not project the newly created venture from building to live." |
| 139 | "The current UI has neither a customer export action nor an actionable handover start; /handover is informational only." |
| 144 | "…the grace timer, read-only pause, recovery UI, and visible banner are explicit prompt-3 stubs." |

Line 144 is legitimately prompt-3 scope. Line 139 sits directly against §23's "**Do not build the handover flow 'later'**". Lines 31 and 51 are unclaimed gaps in prompt-1 territory.

---

## 6. Deviations

| # | Spec | Built instead | Why (where discoverable) | Hurts prompt 2? |
|---|---|---|---|---|
| 1 | §22.9 gallery renders every primitive | 23 of 25; `Empty` and `StalenessBanner` absent | Not documented — looks like an oversight | No |
| 2 | §22.9 visual baselines committed | Committed but drifted 970px on its own platform | Not documented | No, but it will keep CI red |
| 3 | §21 bootstrap via docker-compose | Silent fallback to embedded PGlite, web-only, when Docker is absent | `bootstrap.sh:47` prints the degradation and tells you to install Docker | **Yes** — see below |
| 4 | §17 "**OpenTelemetry** spans across the whole run tree" | Hand-rolled ~111-line tracer with an OTel-shaped surface | Documented at `tracing.ts:6-13`: the SDK is "a large dependency whose only job here would be to print to the console… `exportSpan` is the seam" | Mild — prompt 5 must swap in a real OTLP exporter |
| 5 | §10 flat tool ids | `shopify.*` / `stripe.*` prefixes | Resolves the real `product.upsert` collision | No — improvement |
| 6 | §21 demo finishes "in roughly 90 seconds of accelerated time" | 2.9s (`MOCK_STREAM_JITTER_MS=0` pinned in the `demo` script) | Not documented | No, but the sales-demo pacing §21 describes is not what ships |
| 7 | §22 stubs carry a `TODO(prompt-N)` header | Mirror and MCP deferrals have interfaces but no marker | Not documented | Mild — greppability of remaining work is reduced |
| 8 | 50 comments cite `CLAUDE.md` §-numbers | No `CLAUDE.md` in the repo | Not documented | **Yes** — see below |
| 9 | §22.12 test proves *every* spend tool is gated | Test covers one fixture tool; enforcement is structural | Not documented | No |
| 10 | Auth | No signup form, no Supabase Auth bridge; offline bypass only | `kiln.spec.ts:31` | Depends on prompt-2 scope |

### Deviations that make prompt 2 harder

**#8 — the missing `CLAUDE.md`.** Fifty comments across the most load-bearing modules (`pipeline.ts`, `define.ts`, `egress.ts`, `distance.ts`, `type-pairings.ts`, `rls.test.ts`) cite section numbers in a document that is not in the tree. Some encode requirements found nowhere else — `type-pairings.ts:4` says "CLAUDE.md §3.4 requires at least 24 real…". Whoever picks this up cannot check the code against its stated contract. The build prompt was evidently meant to land as `CLAUDE.md`. **Copy the spec into the repo before prompt 2 starts.**

**#3 — the Docker fallback.** Prompt 2 is live integrations: real Shopify provisioning, DNS, Vercel deploys, Resend domain auth. Those need Redis and MinIO, which the fallback silently skips, and they need the worker and MCP processes, which the fallback does not start. The degradation is announced on stderr but `bootstrap` still exits 0, so an unattended run looks green while delivering a web-only environment. Prompt 2 will hit this on day one.

---

## 7. Verdict

**Prompt 1 is not done, but it is close, and the gap is narrow and specific rather than structural.** The engineering here is better than the definition of done requires in several places: the RLS suite refuses to trust itself until it has proved it dropped superuser; the tool pipeline enforces spend authorisation structurally rather than per-tool; the event log rejects mutation even as superuser; 92/92 tools have deterministic simulations; zero `any`, zero oversized files, zero float money, zero provider leakage — and the lint that enforces those is a genuine AST walk, not a rubber stamp. Nine of twelve criteria pass on pasted evidence. What fails is small: two unrendered UI primitives and a 970-pixel baseline drift. What is unverified is more awkward than serious — criterion 1 is blocked by this machine having no Docker, and criterion 3's mid-run reload is untested because the e2e that would drive it is disabled by a `test.fixme` admitting the worker cannot project a run to `live` under embedded Postgres. That last one is the only finding that suggests something real is missing rather than merely unproven, and it is also the one most likely to bite prompt 2. I would not call this done; I would call it a half-day from done.

### Ordered fix list, shortest path first

1. **Copy the spec into the repo as `CLAUDE.md`.** One `cp`. Immediately un-breaks 50 dangling references. Do this first regardless of everything else.
2. **Add `Empty` and `StalenessBanner` to the design gallery**, then regenerate and commit the baseline (`npx playwright test --update-snapshots`). Closes criterion 9's second half.
3. **Resolve the 970px baseline drift** while regenerating — confirm it is the two added primitives and not an unrelated visual regression that has been sitting under a stale snapshot.
4. **Pin the tool roster.** Replace `catalogue.test.ts`'s 9-id `arrayContaining` with an assertion over the full 92-id list, so a deletion cannot pass silently.
5. **Verify criterion 1 on a machine with Docker.** Nothing in the code needs changing; the path just needs exercising. Consider making `bootstrap` exit non-zero (or require an explicit `KILN_ALLOW_EMBEDDED=1`) when Docker is absent, so a degraded bootstrap cannot read as success in CI.
6. **Write the mid-run reload test** (criterion 3). Needs the worker to run against the same database as web — which is the same blocker as `kiln.spec.ts:51`. Fixing that un-skips a second e2e and closes the only genuinely unproven capability.
7. **Add `TODO(prompt-4)` / `TODO(prompt-2)` headers** to `packages/mirror/` and `apps/mcp/src/server.ts` so the deferral inventory is greppable.
8. **Rename or broaden the "every spend-effect tool" test** so its name matches what it enumerates.

Items 1–4 are under an hour and take the score to 10 PASS / 0 FAIL / 2 UNVERIFIED. Items 5–6 are the real work and are what stand between this and an honest twelve.

**One process note, unrelated to the criteria:** the repository has **zero commits**. §24 asked for "coherent, reviewable slices with real commit messages". There is no history to review, no bisect, and no way to recover from a bad edit. Commit before touching anything.

---

## 8. Addendum — criterion 2 was passing vacuously (found and fixed after the audit above)

**Finding.** `demo:run` reported `quality cleared: true`, and criterion 2 was scored PASS on it. That claim was empty. When the mock provider is asked for a string whose field name matches none of its templates it returns one of three sentences from `FALLBACK_SENTENCES` (`packages/model-gateway/templates.ts`) — "Synthetic fixture value produced for this sandboxed run.", "Recorded during the offline build; no live source was consulted.", "Derived from the brief rather than from market data." Those sentences are grammatical, unhedged, and match none of the eight regexes in `placeholderRule`, none of the banned dictionary, and no other slop rule. Nothing in `packages/quality/` referenced the gateway at all. An artifact built entirely from them cleared every gate.

It was reaching shipped output: the committed `design-gallery-chromium-linux.png` renders "Synthetic fixture value produced for this sandboxed run. for display" in the slot where a font family belongs. **Regenerating that baseline before fixing this — fix-list items 2 and 3 — would have frozen the filler in as golden.** Item 3's instruction to check the 970px drift was diffing pixels, not reading words.

**Scope.** Instrumenting `synthString` showed ~45 distinct field keys falling through to the fallback across a golden run, including `excerpt`, `writes` (brand voice examples), `hex`, `family`, `currentSolution`, `problem`, `measurable`, `aspiresTo`, `abandonIf`, `risk`. Array elements were the largest single cause: they arrive keyed by their index (`"0"`, `"1"`), which matches no template, so every string inside every array fell through.

**Changes.**

1. `packages/quality/slop-lint/rules.ts` — new `fixtureFillerRule` (severity `block`), registered in `ALL_RULES`. Matches the fallback sentences verbatim from a new `packages/quality/dictionaries/fixture-filler.json`.
2. `tests/contracts/fixture-filler-parity.test.ts` — 4 tests. Fails if the gateway's `FALLBACK_SENTENCES` and the linter's dictionary ever diverge, so the hole cannot silently reopen.
3. `packages/model-gateway/templates.ts` — `synthString` now resolves an array element's key to its nearest named ancestor, and resolves palette roles (`text`, `background`, `primary`…) by path rather than by name, since those names collide with prose fields. Added templates for the brand, design-token, strategy and validation fields that were falling through.

**Effect.** Adding rule (1) alone turned the suite red: **7 tests failed across 3 files**, every one a `SlopLintFailed` on `strategy_memo`, then `brand_system`, then `supply_plan` as each was fixed — three separate artifact types shipping filler as customer-facing copy. The repair loop could not recover, because repair also runs through the mock. After (3), the suite is green on real output: **461 passed, 55 files**, `pnpm lint` clean, typecheck clean, `demo:run` still 15 artifacts / 4 checkpoints / `quality cleared: true` — now meaning something. Golden-run snapshots were regenerated, correctly: they record mock output, and mock output changed.

**Known follow-up.** The replacement templates are longer than the one-line filler, which pushes two agents (`compliance-officer`, `storefront-engineer`) slightly over their context budget during `demo:run` — a warning, not a failure. Shortening the catch-all generators trips `sentence-length-uniformity` on product descriptions instead, so this needs generators with varied cadence rather than a smaller word count.

**Unchanged deliberately.** The Playwright visual baseline was **not** regenerated. It is still red, now also because `Empty` and `StalenessBanner` were added to the gallery (fix-list item 2). It should be regenerated only once someone has looked at what the new brand preview actually renders.

**Also applied from the fix list:** item 4 (full 92-id roster pinned by snapshot, replacing the 9-id `arrayContaining`), item 7 (`TODO(prompt-4)` in `packages/mirror/types.ts`, `TODO(prompt-2)` in `apps/mcp/src/server.ts`), item 8 (spend test renamed to match what it enumerates, with a comment recording where the real guarantee lives). Item 1 (`CLAUDE.md`) could not be done from here — the spec is outside the repository tree. Items 5 and 6 remain the real work.
