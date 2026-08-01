import { createHash } from "node:crypto";
import {
  ARTIFACT_SCHEMAS,
  Entitlements,
  QualityReport,
  Scope,
  type ArtifactType,
  type QualityGateId,
  type RunEvent,
} from "@kiln/contracts";
import { synthesize } from "@kiln/model-gateway";
import { sql } from "drizzle-orm";
import { asServiceRole, closeDb, getDb, rowsOf, type Database } from "../client.js";
import { applySchema } from "../migrate.js";

const DEMO_ACCOUNT_ID = stableUuid("kiln:demo-account");
const DEMO_USER_ID = stableUuid("kiln:demo-user");
const FIXED_INSTANT = "2026-06-01T09:00:00.000Z";

const BUILD_SCOPES = [...Scope.options];
const PLAYBOOK_IDS = ["physical-shopify", "digital-product", "local-service"];
const PLANS = [
  {
    name: "Founder", priceWeeklyCents: 19_900,
    entitlements: Entitlements.parse({
      schemaVersion: 1, "ventures.max": 1, "autonomy.max": "guided", "credits.weekly": 50_000,
      "model.tier.max": "standard", "playbooks.allowed": PLAYBOOK_IDS, "scopes.granted": BUILD_SCOPES,
      "support.tier": "community", "handover.included": false, "lane.priority": false,
    }),
  },
  {
    name: "Operator", priceWeeklyCents: 49_900,
    entitlements: Entitlements.parse({
      schemaVersion: 1, "ventures.max": 3, "autonomy.max": "autonomous", "credits.weekly": 200_000,
      "model.tier.max": "deep", "playbooks.allowed": PLAYBOOK_IDS, "scopes.granted": BUILD_SCOPES,
      "support.tier": "priority", "handover.included": true, "lane.priority": false,
    }),
  },
  {
    name: "Studio", priceWeeklyCents: 120_000,
    entitlements: Entitlements.parse({
      schemaVersion: 1, "ventures.max": 10, "autonomy.max": "autonomous", "credits.weekly": 750_000,
      "model.tier.max": "deep", "playbooks.allowed": ["*"], "scopes.granted": BUILD_SCOPES,
      "support.tier": "dedicated", "handover.included": true, "lane.priority": true,
    }),
  },
] as const;

interface PhaseSeed {
  readonly key: string;
  readonly title: string;
  readonly produces: readonly ArtifactType[];
}

const COMMON_PHASES: readonly PhaseSeed[] = [
  { key: "intake", title: "Understand the idea", produces: ["venture_brief"] },
  { key: "validation", title: "Validate demand", produces: ["validation_report", "unit_economics"] },
  { key: "strategy", title: "Position the business", produces: ["strategy_memo"] },
  { key: "identity", title: "Build the brand", produces: ["brand_system"] },
  { key: "offer", title: "Design the offer", produces: ["product_catalogue"] },
];

const FINISH_PHASES: readonly PhaseSeed[] = [
  { key: "content", title: "Write everything", produces: ["content_set"] },
  { key: "compliance", title: "Clear compliance", produces: ["compliance_report", "policy_set"] },
  { key: "build", title: "Build the selling surface", produces: ["storefront_build"] },
  { key: "growth", title: "Plan the launch", produces: ["growth_plan"] },
  { key: "qa", title: "Test everything", produces: ["quality_report"] },
  { key: "launch", title: "Go live", produces: [] },
  { key: "operate", title: "Run it", produces: ["operating_digest"] },
];

const ALL_GATES: readonly QualityGateId[] = [
  "product-descriptions", "product-imagery", "no-broken-links", "no-placeholders", "lighthouse",
  "checkout-transacts", "policies-present", "email-authentication", "analytics-purchase-event",
  "compliance-clear", "positive-contribution-margin",
];

const COMPLETED = [
  {
    name: "Ember & Ash", archetype: "physical" as const, playbookId: "physical-shopify",
    oneLiner: "I want to sell handmade ceramic incense holders to people who value slow rituals.",
    domain: "emberandash.test",
    phases: [
      ...COMMON_PHASES,
      { key: "sourcing", title: "Source and cost it", produces: ["supply_plan", "fulfilment_tradeoff"] as ArtifactType[] },
      ...FINISH_PHASES,
    ],
    gates: ALL_GATES,
  },
  {
    name: "Ledger Kit", archetype: "digital" as const, playbookId: "digital-product",
    oneLiner: "I want to sell a practical Notion operating system for independent designers.",
    domain: "ledgerkit.test", phases: [...COMMON_PHASES, ...FINISH_PHASES], gates: ALL_GATES.filter((gate) => gate !== "product-imagery"),
  },
  {
    name: "Cogwright", archetype: "service" as const, playbookId: "local-service",
    oneLiner: "I want to run a mobile bicycle repair service around Leeds.",
    domain: "cogwright.test", phases: [...COMMON_PHASES, ...FINISH_PHASES],
    gates: ALL_GATES.filter((gate) => !["product-imagery", "checkout-transacts", "analytics-purchase-event"].includes(gate)),
  },
] as const;

function stableUuid(material: string): string {
  const bytes = createHash("sha256").update(material).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalise(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  if (typeof value !== "object") throw new Error(`Cannot hash ${typeof value}`);
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalise(item)}`).join(",")}}`;
}

function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalise(value)).digest("hex");
}

function passingQuality(gates: readonly QualityGateId[]): unknown {
  return QualityReport.parse({
    results: gates.map((gate) => ({
      gate, passed: true, overridden: false, evaluatedAt: FIXED_INSTANT,
      assertions: [{ assertion: `${gate} acceptance probe passes`, passed: true, observed: "Verified in sandbox fixture." }],
    })),
    clearedForLaunch: true, hasOverrides: false, evaluatedAt: FIXED_INSTANT,
  });
}

async function event(tx: Database, runId: string, payload: RunEvent, actor: "agent" | "human" | "system" = "system") {
  await tx.execute(sql`
    INSERT INTO run_events (run_id, type, payload, actor)
    VALUES (${runId}, ${payload.type}, ${JSON.stringify(payload)}::jsonb, ${actor})
  `);
}

async function seedPlans(tx: Database): Promise<string> {
  for (const plan of PLANS) {
    await tx.execute(sql`
      INSERT INTO plans (name, price_weekly_cents, entitlements, active)
      VALUES (${plan.name}, ${plan.priceWeeklyCents}, ${JSON.stringify(plan.entitlements)}::jsonb, true)
      ON CONFLICT (name) DO UPDATE SET price_weekly_cents = EXCLUDED.price_weekly_cents,
        entitlements = EXCLUDED.entitlements, active = true
    `);
  }
  const studio = rowsOf<{ id: string }>(await tx.execute(sql`SELECT id FROM plans WHERE name = 'Studio'`))[0];
  if (!studio) throw new Error("Studio plan was not seeded");
  return studio.id;
}

async function seedIdentity(tx: Database, planId: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO accounts (id, name, plan_id, status, autonomy_default, budget_weekly_cents, kyc_status, kyc_verified_at)
    VALUES (${DEMO_ACCOUNT_ID}, 'Demo Studio', ${planId}, 'active', 'guided', 120000, 'verified', now())
    ON CONFLICT (id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active',
      kyc_status = 'verified', kyc_verified_at = COALESCE(accounts.kyc_verified_at, now())
  `);
  await tx.execute(sql`
    INSERT INTO users (id, account_id, email, name, role)
    VALUES (${DEMO_USER_ID}, ${DEMO_ACCOUNT_ID}, 'demo@kiln.local', 'Demo Owner', 'owner')
    ON CONFLICT (email) DO UPDATE SET account_id = EXCLUDED.account_id, name = EXCLUDED.name
  `);
  const subscription = rowsOf<{ id: string }>(
    await tx.execute(sql`SELECT id FROM subscriptions WHERE account_id = ${DEMO_ACCOUNT_ID} LIMIT 1`),
  )[0];
  if (!subscription) {
    await tx.execute(sql`
      INSERT INTO subscriptions (account_id, plan_id, status, current_period_end)
      VALUES (${DEMO_ACCOUNT_ID}, ${planId}, 'active', now() + interval '7 days')
    `);
  } else {
    await tx.execute(sql`
      UPDATE subscriptions SET plan_id = ${planId}, status = 'active'
      WHERE id = ${subscription.id}
    `);
  }
  await tx.execute(sql`
    INSERT INTO credit_ledger (account_id, delta_micros, kind, reason, metadata)
    SELECT ${DEMO_ACCOUNT_ID}, 750000000, 'grant', 'seeded weekly Studio credit grant', '{}'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM credit_ledger WHERE account_id = ${DEMO_ACCOUNT_ID} AND kind = 'grant')
  `);
  await tx.execute(sql`
    UPDATE credit_ledger SET delta_micros = 750000000, reason = 'seeded weekly Studio credit grant'
    WHERE id = (
      SELECT id FROM credit_ledger WHERE account_id = ${DEMO_ACCOUNT_ID} AND kind = 'grant'
      ORDER BY created_at ASC LIMIT 1
    )
  `);
}

function artifactContent(type: ArtifactType, seed: string, oneLiner: string, gates: readonly QualityGateId[]): unknown {
  if (type === "quality_report") return passingQuality(gates);
  const generated = synthesize(ARTIFACT_SCHEMAS[type], `${seed}:${type}`);
  return type === "venture_brief"
    ? ARTIFACT_SCHEMAS.venture_brief.parse({ ...generated, oneLiner })
    : generated;
}

async function seedCompleted(tx: Database, spec: (typeof COMPLETED)[number]): Promise<void> {
  const ventureId = stableUuid(`venture:${spec.playbookId}`);
  const runId = stableUuid(`run:${spec.playbookId}`);
  const exists = rowsOf<{ id: string }>(await tx.execute(sql`SELECT id FROM ventures WHERE id = ${ventureId}`))[0];
  if (exists) return;
  const seed = `golden:${spec.playbookId}:v1`;
  const brief = artifactContent("venture_brief", seed, spec.oneLiner, spec.gates);
  await tx.execute(sql`
    INSERT INTO ventures (id, account_id, name, archetype, status, ownership_mode, brief, primary_domain)
    VALUES (${ventureId}, ${DEMO_ACCOUNT_ID}, ${spec.name}, ${spec.archetype}, 'live', 'managed',
      ${JSON.stringify(brief)}::jsonb, ${spec.domain})
  `);
  await tx.execute(sql`
    INSERT INTO runs (id, venture_id, playbook_id, playbook_version, status, autonomy, current_phase,
      budget_micros, spent_micros, seed, sandbox, idempotency_key, started_at, ended_at)
    VALUES (${runId}, ${ventureId}, ${spec.playbookId}, '1.0.0', 'succeeded', 'guided', 'operate',
      6500000, 1800000, ${seed}, true, ${`seed:${spec.playbookId}`}, now() - interval '3 days', now() - interval '70 hours')
  `);
  await event(tx, runId, { type: "run.started", playbookId: spec.playbookId, playbookVersion: "1.0.0", autonomy: "guided", seed, budgetMicros: 6_500_000 });

  for (const [order, phase] of spec.phases.entries()) {
    const phaseId = stableUuid(`${runId}:phase:${phase.key}`);
    await tx.execute(sql`
      INSERT INTO phases (id, run_id, key, title, status, order_index, started_at, ended_at)
      VALUES (${phaseId}, ${runId}, ${phase.key}, ${phase.title}, 'succeeded', ${order}, now() - interval '3 days', now() - interval '70 hours')
    `);
    await event(tx, runId, { type: "phase.started", phaseId: phaseId as never, key: phase.key, title: phase.title });
    for (const type of phase.produces) {
      const artifactId = stableUuid(`${runId}:artifact:${type}`);
      const content = artifactContent(type, seed, spec.oneLiner, spec.gates);
      await tx.execute(sql`
        INSERT INTO artifacts (id, venture_id, run_id, type, version, status, content, content_hash, quality)
        VALUES (${artifactId}, ${ventureId}, ${runId}, ${type}, 1, 'accepted', ${JSON.stringify(content)}::jsonb,
          ${contentHash(content)}, '{"degraded":false,"overridden":false,"criticScore":5,"criticCycles":1,"lintPassed":true}'::jsonb)
      `);
      await event(tx, runId, { type: "artifact.written", artifactId: artifactId as never, artifactType: type, version: 1 }, "agent");
    }
    await event(tx, runId, { type: "phase.succeeded", phaseId: phaseId as never });
  }
  await event(tx, runId, { type: "quality.evaluated", passed: true, failedGates: [] });
  await event(tx, runId, { type: "run.succeeded" });

  for (let day = 89; day >= 0; day--) {
    const orders = Math.max(0, Math.round(3 + Math.sin(day / 5) * 2 + (89 - day) * 0.045));
    const revenueMicros = orders * (2_800 + (day % 5) * 260) * 10_000;
    await tx.execute(sql`
      INSERT INTO metric_snapshots (venture_id, provider, metric_key, ts, value, dimensions, dimensions_hash, currency)
      VALUES
        (${ventureId}, 'shopify', 'orders', now() - (${day} * interval '1 day'), ${orders}, '{}'::jsonb, '', 'USD'),
        (${ventureId}, 'stripe', 'revenue_gross', now() - (${day} * interval '1 day'), ${revenueMicros}, '{}'::jsonb, '', 'USD'),
        (${ventureId}, 'analytics', 'sessions', now() - (${day} * interval '1 day'), ${orders * 42 + 60}, '{}'::jsonb, '', NULL)
      ON CONFLICT DO NOTHING
    `);
  }
  console.log(`  + ${spec.name}: ${spec.phases.flatMap((phase) => phase.produces).length} artifacts, 90 metric days`);
}

const ASSETS_BY_PLAYBOOK = {
  "physical-shopify": [
    ["shopify-store", "shopify", "Storefront"],
    ["domain", "registrar", "Primary domain"],
    ["stripe-account", "stripe", "Payments"],
    ["email-domain", "resend", "Transactional email"],
    ["brand-assets", "kiln-assets", "Brand source files"],
    ["git-repository", "github", "Storefront source"],
  ],
  "digital-product": [
    ["domain", "registrar", "Primary domain"],
    ["stripe-account", "stripe", "Payments"],
    ["email-domain", "resend", "Transactional email"],
    ["brand-assets", "kiln-assets", "Brand source files"],
    ["git-repository", "github", "Product source"],
  ],
  "local-service": [
    ["domain", "registrar", "Primary domain"],
    ["dns-zone", "dns", "DNS zone"],
    ["email-domain", "resend", "Business email"],
    ["booking-account", "cal-com", "Booking account"],
    ["brand-assets", "kiln-assets", "Brand source files"],
    ["git-repository", "github", "Website source"],
  ],
} as const;

async function seedDemoAssets(tx: Database): Promise<void> {
  for (const spec of COMPLETED) {
    const ventureId = stableUuid(`venture:${spec.playbookId}`);
    for (const [kind, provider, label] of ASSETS_BY_PLAYBOOK[spec.playbookId]) {
      const id = stableUuid(`${ventureId}:asset:${kind}`);
      await tx.execute(sql`
        INSERT INTO assets (id, venture_id, kind, provider, external_id, display_name,
          ownership_mode, status, metadata, provisioned_at)
        VALUES (${id}, ${ventureId}, ${kind}, ${provider}, ${`demo:${spec.playbookId}:${kind}`},
          ${label}, 'managed', 'active', ${JSON.stringify({ fixture: true, transferable: true })}::jsonb,
          now() - interval '70 hours')
        ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
          ownership_mode = EXCLUDED.ownership_mode, status = EXCLUDED.status,
          metadata = EXCLUDED.metadata
      `);
    }
  }
}

async function seedPausedRun(tx: Database): Promise<void> {
  const ventureId = stableUuid("venture:paused-demo");
  const runId = stableUuid("run:paused-demo");
  if (rowsOf(await tx.execute(sql`SELECT id FROM ventures WHERE id = ${ventureId}`)).length > 0) return;
  const seed = "golden:paused-physical:v1";
  const oneLiner = "I want to sell modular balcony planters for small rental apartments.";
  const brief = artifactContent("venture_brief", seed, oneLiner, ALL_GATES);
  await tx.execute(sql`
    INSERT INTO ventures (id, account_id, name, archetype, status, ownership_mode, brief)
    VALUES (${ventureId}, ${DEMO_ACCOUNT_ID}, 'Northstar Planters', 'physical', 'building', 'managed', ${JSON.stringify(brief)}::jsonb)
  `);
  await tx.execute(sql`
    INSERT INTO runs (id, venture_id, playbook_id, playbook_version, status, autonomy, current_phase,
      budget_micros, spent_micros, seed, sandbox, idempotency_key, started_at)
    VALUES (${runId}, ${ventureId}, 'physical-shopify', '1.0.0', 'waiting_on_checkpoint', 'guided', 'identity',
      6500000, 620000, ${seed}, true, 'seed:paused-demo', now() - interval '35 minutes')
  `);
  await event(tx, runId, { type: "run.started", playbookId: "physical-shopify", playbookVersion: "1.0.0", autonomy: "guided", seed, budgetMicros: 6_500_000 });
  for (const [order, phase] of COMMON_PHASES.slice(0, 4).entries()) {
    const phaseId = stableUuid(`${runId}:phase:${phase.key}`);
    await tx.execute(sql`
      INSERT INTO phases (id, run_id, key, title, status, order_index, started_at, ended_at)
      VALUES (${phaseId}, ${runId}, ${phase.key}, ${phase.title}, 'succeeded', ${order}, now() - interval '30 minutes', now() - interval '25 minutes')
    `);
    await event(tx, runId, { type: "phase.started", phaseId: phaseId as never, key: phase.key, title: phase.title });
    for (const type of phase.produces) {
      const artifactId = stableUuid(`${runId}:artifact:${type}`);
      const content = artifactContent(type, seed, oneLiner, ALL_GATES);
      await tx.execute(sql`
        INSERT INTO artifacts (id, venture_id, run_id, type, version, status, content, content_hash, quality)
        VALUES (${artifactId}, ${ventureId}, ${runId}, ${type}, 1, 'accepted', ${JSON.stringify(content)}::jsonb,
          ${contentHash(content)}, '{"degraded":false,"overridden":false,"criticScore":5,"criticCycles":1,"lintPassed":true}'::jsonb)
      `);
      await event(tx, runId, { type: "artifact.written", artifactId: artifactId as never, artifactType: type, version: 1 }, "agent");
    }
    await event(tx, runId, { type: "phase.succeeded", phaseId: phaseId as never });
  }
  const checkpointId = stableUuid(`${runId}:checkpoint:brand`);
  const phaseId = stableUuid(`${runId}:phase:identity`);
  const options = [
    { id: "approve", label: "Approve direction", description: "Continue with this identity.", consequence: "Offer design begins.", recommended: true },
    { id: "revise", label: "Ask for changes", description: "Return to the Brand Director.", consequence: "The run stays paused.", recommended: false },
  ];
  await tx.execute(sql`
    INSERT INTO checkpoints (id, run_id, phase_id, kind, title, prompt, options, status, expires_at)
    VALUES (${checkpointId}, ${runId}, ${phaseId}, 'hard_gate', 'Approve the brand direction',
      ${JSON.stringify({ question: "Does this feel like the business you want to own?", context: "Review the name, palette, typography, and voice before product work begins.", artifactIds: [stableUuid(`${runId}:artifact:brand_system`)] })}::jsonb,
      ${JSON.stringify(options)}::jsonb, 'pending', now() + interval '72 hours')
  `);
  await event(tx, runId, { type: "checkpoint.requested", checkpointId: checkpointId as never, kind: "hard_gate", title: "Approve the brand direction" });
  console.log("  + Northstar Planters: paused at a live approval checkpoint");
}

async function main(): Promise<void> {
  await applySchema();
  const db = await getDb();
  await asServiceRole(db, async (tx) => {
    const planId = await seedPlans(tx);
    await seedIdentity(tx, planId);
    for (const spec of COMPLETED) await seedCompleted(tx, spec);
    await seedDemoAssets(tx);
    await seedPausedRun(tx);
  });
  console.log("\nSeeded demo@kiln.local with three completed ventures and one pending approval.\n");
  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error("seed failed\n", error);
  await closeDb();
  process.exitCode = 1;
});
