# KILN — Handoff after Prompt 1

Companion to [AUDIT-1.md](./AUDIT-1.md). That file says what is proven; this one says what exists and what you need to know to keep building.

**Read first:** the spec is **not in this repository**. It lives at
`~/.config/Claude/local-agent-mode-sessions/75329957-.../outputs/KILN-one-shot-build-prompt.md`.
Fifty source comments cite it as `CLAUDE.md §N`. Copy it to `./CLAUDE.md` before you do anything else.

**Also:** the repo has **zero commits**. Commit the tree before your first edit.

---

## 1. File tree as actually built

pnpm workspace, 21 projects, turbo for `build`/`typecheck`, vitest at the root.

```
KILN/
├── apps/
│   ├── mcp/          simulate-only MCP server (server.ts, tokens.ts)
│   ├── web/          Next.js App Router — (marketing) (auth) (app) (admin) + api/
│   └── worker/       run executor, job poller, replay, demo
├── packages/
│   ├── contracts/    zod artifact schemas, RunEvent, KilnError hierarchy
│   ├── config/       env parsing, provider registry, sandbox defaults
│   ├── db/           drizzle schema, migrations/, policies/, seed
│   ├── model-gateway/ kimi + deepseek + mock adapters, synthesize(), budget
│   ├── tools/        core/ (define, pipeline, registry, egress, quarantine)
│   │                 catalogue/ (14 domains, 92 tools)
│   ├── runtime/      orchestrator, event log, fold/projection, tool-loop, quality-runner
│   ├── agents/       typed agent declarations + prompts (no framework)
│   ├── playbooks/    physical-shopify, digital-product, local-service, router
│   ├── quality/      slop-lint/, gates/, rubrics/
│   ├── design-engine/ tokens, type-pairings, distance
│   ├── ui/           25 primitives + tokens.css
│   ├── billing/      adapters, entitlements, lifecycle, processor, service
│   ├── connectors/   types, mock, live (stubs), handover/assembler
│   ├── mirror/       types, postgres store, reconciler
│   ├── vault/        libsodium DEK envelope crypto
│   ├── jobs/         queue contracts
│   └── observability/ logger, redaction, tracing, cost
├── docs/             adr/0001–0005, runbooks/{handover,abuse}, subprocessors, data-retention, agent-authoring
├── fixtures/         runs/ (3 golden), slop/{known-bad,known-good}, model/, connectors/
├── tests/            e2e/ (playwright), evals/, security/, contracts/
└── scripts/          bootstrap.sh, dev.sh, lint.ts, scan-build-secrets.ts, secret-scanner.ts
```

Size and test distribution — note the two packages with **zero test files**:

| Package | Files | Lines | Test files |
|---|---:|---:|---:|
| packages/tools | 33 | 5,702 | 5 |
| apps/web | 68 | 4,764 | 7 |
| packages/contracts | 24 | 3,264 | **0** |
| packages/runtime | 19 | 2,557 | 4 |
| apps/worker | 17 | 2,425 | 2 |
| packages/db | 22 | 2,174 | 1 |
| packages/model-gateway | 13 | 1,952 | 1 |
| packages/quality | 11 | 1,562 | 3 |
| packages/agents | 92 | 1,425 | 14 |
| packages/design-engine | 8 | 1,138 | 1 |
| packages/billing | 13 | 1,079 | 4 |
| packages/connectors | 19 | 1,014 | 2 |
| packages/vault | 5 | 883 | 1 |
| packages/jobs | 5 | 466 | 2 |
| packages/observability | 7 | 474 | 1 |
| packages/mirror | 5 | 379 | 1 |
| packages/playbooks | 7 | 383 | **0** |
| packages/ui | 9 | 354 | **0** |
| packages/config | 5 | 321 | 1 |
| apps/mcp | 5 | 376 | 1 |

`contracts` and `playbooks` are covered indirectly (`tests/contracts/roundtrip.test.ts`, `tests/evals/golden-runs.test.ts`); `ui` is covered only by the e2e visual baseline, which is currently **failing**.

No file exceeds 400 lines — enforced by `scripts/lint.ts:33`.

---

## 2. Stubbed interfaces — exact signatures, grouped by the prompt that fills them

Every stub below is fully typed and exported. None is an empty shell.

### → Prompt 2 (live integrations)

`packages/connectors/types.ts` — implemented by `LiveConnectorStub` (`live.ts:27`), whose methods all throw `LiveConnectorUnavailable`:

```ts
export interface Connector {
  readonly provider: ConnectorProvider;
  readonly mode: ConnectorMode;
  readonly rotation: RotationPolicy;
  reconcile(request: ReconciliationRequest): Promise<ReconciliationBatch>;
  issueRotationCredential(request: RotationRequest): Promise<string>;
  verifyRotationCredential(secret: string, request: RotationRequest): Promise<boolean>;
}

export type RotationRequest = z.infer<typeof RotationRequest>;
// { credentialId: uuid; accountId: uuid; provider: ConnectorProvider }
```

`packages/tools/core/define.ts:46-49` — the two seams the worker currently closes off:

```ts
/** Resolves a credential handle at request time. Never returns a raw secret. */
readonly lease: (assetKind: string, scopes: readonly string[]) => Promise<CredentialHandle>;
/** Egress-controlled HTTP client. Direct `fetch` is banned inside tools. */
readonly http: EgressClient;
```

Current prompt-1 implementations (`apps/worker/run-adapter.ts:195-198`) both throw:

```ts
lease: async () => { throw new Error("Sandbox run tools never lease credentials; TODO(prompt-2) for live connector leases"); },
http: { fetch: async () => { throw new Error("Direct worker egress is disabled; TODO(prompt-2)"); } },
```

Also prompt-2, **no `TODO` marker present**: `apps/mcp/src/server.ts:80` calls `tool.simulate(...)`. There is no `execute` path in the MCP server.

### → Prompt 3 (billing)

`packages/billing/lifecycle.ts`:

```ts
export interface BillingLifecycleHooks {
  onInvoicePaid(event: StripeEvent): Promise<void>;
  onPaymentFailed(event: StripeEvent): Promise<void>;
  onSubscriptionChanged(event: StripeEvent): Promise<void>;
  onTrialWillEnd(event: StripeEvent): Promise<void>;
}

// TODO(prompt-3): dunning timers, proration policy, metered credit grants, notifications.
export const promptOneLifecycleHooks: BillingLifecycleHooks = {
  async onInvoicePaid() {}, async onPaymentFailed() {},
  async onSubscriptionChanged() {}, async onTrialWillEnd() {},
};
```

### → Prompt 4 (mirror and operating loop)

`packages/mirror/types.ts` — **no `TODO(prompt-4)` marker anywhere in this package**; the marker is in `connectors/live.ts` instead:

```ts
export interface MirrorStore {
  loadConnection(connectionId: string): Promise<MirrorConnection | undefined>;
  persistBatch(connection: MirrorConnection, batch: ReconciliationBatch): Promise<MirrorWriteResult>;
  markFailure(connectionId: string, error: unknown, at: string): Promise<void>;
}
```

`MirrorReconciler` is implemented and coordinates polling/persistence without knowing any provider payload shape. It is inert only because `Connector.reconcile` throws in live mode.

### → Prompt 5 (handover, hardening)

`packages/connectors/types.ts` — implemented by `LiveEscrowSchedulerStub` (`live.ts:49`):

```ts
export interface EscrowScheduler {
  readonly mode: ConnectorMode;
  schedule(request: EscrowScheduleRequest): Promise<EscrowScheduleReceipt>;
}

export type EscrowScheduleRequest = z.infer<typeof EscrowScheduleRequest>;
// { ventureId: uuid; accountId: uuid; recipientPublicKey: string(≥16); scheduledFor: datetime }
export type EscrowScheduleReceipt = z.infer<typeof EscrowScheduleReceipt>;
// { scheduleKey: string(64); mode; ventureId: uuid; scheduledFor: datetime; status: "scheduled" | "stubbed" }
```

Packet **assembly and recipient-only encryption ship in prompt 1** (`connectors/handover/assembler.ts`, `break_glass_packets` table with RLS). Only storage-offload and scheduling are deferred.

---

## 3. Decisions the build made that the spec left open

Recorded in ADRs:

| Decision | Where | Substance |
|---|---|---|
| No agent framework | ADR 0002 | No LangChain/CrewAI/AutoGen. Agents are typed declarations; the runtime owns message assembly. |
| Custody model | ADR 0003 | KILN builds and operates venture assets but is **not** merchant of record for the venture's customer sales by default. |
| Vault crypto | ADR 0004 | Per-credential random DEK, libsodium secretbox, random nonce, pluggable key provider. |
| Sandbox-first defaults | ADR 0005 | Empty env → `MODEL_PROVIDER=mock`, mock appended as final fallback, sandbox on outside production, **embedded PostgreSQL**. |
| Stack baseline | ADR 0001 | Next.js App Router, drizzle, PGlite/Postgres, pnpm+turbo, vitest+playwright. |

Made in code, **not** recorded in any ADR — these are the ones to re-litigate consciously rather than inherit by accident:

1. **Tool ids are namespaced.** `shopify.product.upsert` / `stripe.product.upsert` rather than §10's flat `product.upsert`. Forced by a genuine collision between the two domains. 20 ids carry a prefix.
2. **Tracing is hand-rolled, not OpenTelemetry.** ~111 lines with an OTel-shaped surface; `exportSpan` is the documented seam (`tracing.ts:6-13`). §17 asked for OTel spans. Swapping in the real SDK is a one-file change *if* nothing above it started depending on the local shape.
3. **Resume granularity is the phase, not the task.** Re-executing an interrupted run redoes the in-flight phase (measured: 1602 events vs ~1471 for a clean run, artifacts still 15 — no duplication). Correct trade-off, but assume phase-level idempotency when you add live side effects in prompt 2.
4. **`demo:run` mints a new run id every invocation** (`demo.ts:46`). It is a smoke test, not a resumable job. The resume path exists on `PostgresRunExecutor` and is exercised only by re-dispatch.
5. **Demo runs in ~2.9s**, not the "roughly 90 seconds of accelerated time" §21 describes — `MOCK_STREAM_JITTER_MS=0` is pinned in the `demo` script. Set it to `8` to get a human-watchable pace.
6. **KYC gates conservatively.** No verification provider is wired, and `livePublishBlockReason` (`apps/worker/tool-policy.ts:79`) therefore **blocks** live publish with `kyc-required`. Prompt 3 must supply a real verification path or nothing will ever publish live.
7. **Auth is an offline bypass.** No signup form, no Supabase Auth bridge (`kiln.spec.ts:31`).
8. **`/handover` is informational only** — no customer export action, no actionable start (`kiln.spec.ts:139`). This sits against §23's "do not build the handover flow later"; the escrow *primitives* exist, the flow does not.
9. **Vault access reaches the worker.** `apps/worker/bootstrap.ts:13` imports `rotate` from `@kiln/vault`. Intended per ADR 0004, but note `scripts/lint.ts:50` only forbids the import in `apps/web/` — the boundary is narrower than "tools only".

---

## 4. Test and quality-gate coverage

Everything below was run in this audit, on Node 22.23.2 / pnpm 9.15.4.

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck --force` | **21/21 pass**, 0 cached (forced — the default run is all cache hits) |
| Structural lint | `pnpm lint` | **pass** — AST walk for `any`, vault leak, direct `fetch` in tools, hardcoded model ids, >400-line files |
| Unit + integration | `pnpm test` | **54 files, 456 tests, all pass** (~4s) |
| Coverage | `pnpm test:coverage` | **pass** — Lines 85.39%, Statements 81.94%, Functions 87.2%, Branches 68.89% |
| E2E | `npx playwright test` | **9 passed, 1 FAILED, 4 skipped** |
| Golden runs | `npx vitest run tests/evals` | **3/3** — all playbooks complete, deterministic, launch-clear |

Coverage thresholds (80% lines, enforced per-package in `vitest.config.ts`) all met:
`runtime` 86.73 · `tools/core` 84.42 · `billing` 81.81 · `vault` 93.75.

Weakest covered files, if you are looking for where to add tests: `billing/processor.ts` 60.65%, `tools/core/egress.ts` 73.23%, `tools/core/pipeline.ts` 75.00%, `runtime/tool-loop.ts` 77.35%, `runtime/orchestrator.ts` 77.92%.

**The one red gate:** `design gallery renders the primitive visual baseline` — 970 pixels differ (ratio 0.01) against `design-gallery-chromium-linux.png` on chromium/linux, so this is drift, not a platform mismatch. Separately, `Empty` and `StalenessBanner` are exported from `packages/ui` but never rendered in the gallery (23 of 25 primitives shown).

**Permanently disabled e2e** (`test.fixme(true, …)`) — read these as a to-do list, they are honest:

| Line | Admission |
|---|---|
| 31 | no signup form or wired Supabase Auth bridge |
| 51 | run success does not project a venture from `building` to `live` under embedded PGlite |
| 139 | no customer export action, no actionable handover start |
| 144 | grace timer / read-only pause / recovery UI are prompt-3 stubs |

---

## 5. The three things most likely to bite you

### 1. The environment lies about being ready

`pnpm bootstrap` **exits 0 without Docker.** It prints `Docker is unavailable; using embedded Postgres and starting the web process only` to stderr and carries on. That means no Redis, no MinIO, and **no worker or MCP process** — while the exit code says success. Prompt 2 is live integrations (Shopify provisioning, DNS, Vercel, Resend); every one of those needs the services the fallback skips. Expect to lose an afternoon to "it bootstrapped fine, why is nothing running". Make the fallback explicit (`KILN_ALLOW_EMBEDDED=1`) or non-zero before you trust CI.

Related trap for anyone reproducing this audit: `pnpm` is not on the default `PATH` and the default Node is 20 while the repo needs ≥22. Use `~/.nvm/versions/node/v22.23.2/bin`.

### 2. The worker and the web app do not share a database in the default setup

This is the root cause of two of the four disabled e2e tests, and it is the only finding in the audit that suggests something is genuinely missing rather than merely unproven. Under embedded PGlite the stack runs web-only, so a run started from intake never advances through the worker, and a venture never transitions `building → live`. Consequences you will hit directly:

- **Criterion 3 (mid-run theatre reload) has never been tested.** Reload of a *completed* run is proven; mid-run is not, because nothing can drive a live run through the worker in the test environment.
- Any prompt-4 work on the venture dashboard inherits a `building → live` projection that has never executed end-to-end.

Fix this first if you plan to touch the runtime, the theatre, or the dashboard. It un-skips two e2e tests and closes the last unproven §22 criterion.

### 3. Fifty comments point at a document that does not exist

`CLAUDE.md` is cited as normative in `pipeline.ts`, `define.ts`, `egress.ts`, `distance.ts`, `type-pairings.ts`, `rls.test.ts`, and 44 other places. Some encode requirements found nowhere else in the tree — `type-pairings.ts:4` asserts "CLAUDE.md §3.4 requires at least 24 real…". Without that file you cannot check the code against its own stated contract, and you will be tempted to treat those comments as noise. They are not. **Copy the spec in as `CLAUDE.md` as your first commit.**

---

### Quick orientation for the next session

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm typecheck --force && pnpm lint && pnpm test   # expect green
pnpm demo:run                                       # ~3s, physical-shopify, 15 artifacts
npx playwright test                                 # expect 1 failure: design gallery baseline
```

Read in this order: `packages/contracts` (the vocabulary) → `packages/runtime/orchestrator.ts` + `events.ts` (the event log is truth) → `packages/tools/core/pipeline.ts` (spend authorisation, egress, quarantine) → `apps/worker/run-adapter.ts` (where the durable seams attach).
