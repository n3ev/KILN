import { randomUUID } from "node:crypto";
import { can } from "@kiln/billing";
import { Archetype, Autonomy, VentureBrief, type VentureBrief as VentureBriefValue } from "@kiln/contracts";
import { rowsOf } from "@kiln/db";
import { PostgresJobQueue } from "@kiln/jobs";
import { requirePlaybook } from "@kiln/playbooks";
import { config } from "@kiln/config";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withSessionAccount } from "./session";

const SlotDraft = z.object({
  status: z.enum(["answered", "deferred"]),
  value: z.string().max(4_000),
  reason: z.string().max(1_000),
  inferred: z.boolean().optional(),
}).superRefine((slot, ctx) => {
  if (slot.status === "answered" && slot.value.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "an answered slot needs a value" });
  }
  if (slot.status === "deferred" && slot.reason.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "a deferred slot needs a reason" });
  }
});

export const IntakeDraft = z.object({
  idempotencyKey: z.string().uuid(),
  oneLiner: z.string().trim().min(8).max(500),
  slots: z.object({
    problem: SlotDraft,
    customer: SlotDraft,
    offer: SlotDraft,
    price: SlotDraft,
    differentiation: SlotDraft,
    channel: SlotDraft,
    economics: SlotDraft,
    capital: SlotDraft,
    commitment: SlotDraft,
    geography: SlotDraft,
    fulfilment: SlotDraft,
    redlines: SlotDraft,
  }),
  archetype: Archetype,
  ownershipDisclosureAccepted: z.literal(true),
});
export type IntakeDraft = z.infer<typeof IntakeDraft>;

export class IntakeCommandError extends Error {
  constructor(readonly code: "account_unavailable" | "entitlement_denied" | "queue_unavailable", message: string, readonly status: number) {
    super(message);
    this.name = "IntakeCommandError";
  }
}

const playbookFor = {
  physical: "physical-shopify",
  digital: "digital-product",
  service: "local-service",
} as const;

const AccountRow = z.object({
  status: z.enum(["trialing", "active", "past_due", "suspended", "closed"]),
  autonomy_default: Autonomy,
  entitlements: z.unknown(),
  plan_active: z.boolean(),
});
const ExistingRun = z.object({ run_id: z.string().uuid(), venture_id: z.string().uuid(), playbook_id: z.string() });
const CountRow = z.object({ count: z.coerce.number().int().nonnegative() });

type DraftSlot = z.infer<typeof SlotDraft>;

function customerSource(statement: string) {
  return { kind: "customer" as const, statement };
}

function answered<T>(draft: DraftSlot, value: T) {
  return {
    status: "answered" as const,
    value,
    sources: [customerSource(draft.value.trim())],
    confidence: draft.inferred ? 0.75 : 1,
  };
}

function resolved<T>(draft: DraftSlot, value: () => T, revisitBy = "validation") {
  return draft.status === "deferred"
    ? { status: "deferred" as const, reason: draft.reason.trim(), revisitBy }
    : answered(draft, value());
}

function list(value: string): string[] {
  const items = value.split(/\n|,|;/).map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : [value.trim()];
}

function currency(value: string): "USD" | "GBP" | "EUR" | "CAD" | "AUD" {
  if (/\b(GBP|pounds?|sterling)\b|£/i.test(value)) return "GBP";
  if (/\b(EUR|euros?)\b|€/i.test(value)) return "EUR";
  if (/\b(CAD|Canadian dollars?)\b|C\$/i.test(value)) return "CAD";
  if (/\b(AUD|Australian dollars?)\b|A\$/i.test(value)) return "AUD";
  return "USD";
}

function micros(value: string): number {
  const match = value.replace(/,/g, "").match(/(?:^|[^\d])(\d+(?:\.\d+)?)\s*([km])?/i);
  if (!match?.[1]) return 0;
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1;
  return Math.round(Number(match[1]) * multiplier * 1_000_000);
}

function country(value: string): "AU" | "GB" | "US" | "CA" | "NZ" | "IE" {
  if (/\b(UK|United Kingdom|England|Scotland|Wales|Leeds|London|Manchester|Birmingham|Glasgow|Edinburgh)\b/i.test(value)) return "GB";
  if (/\b(US|USA|United States|America|New York|California|Texas|Chicago|Seattle)\b/i.test(value)) return "US";
  if (/\b(Canada|Toronto|Vancouver|Montreal)\b/i.test(value)) return "CA";
  if (/\b(New Zealand|Auckland|Wellington)\b/i.test(value)) return "NZ";
  if (/\b(Ireland|Dublin|Cork)\b/i.test(value)) return "IE";
  return "AU";
}

function fulfilment(value: string, archetype: IntakeDraft["archetype"]) {
  const model = archetype === "digital"
    ? "digital-download"
    : archetype === "service"
      ? "in-person"
      : /print[ -]?on[ -]?demand/i.test(value)
        ? "print-on-demand"
        : /wholesale|stock|warehouse/i.test(value)
          ? "wholesale-stock"
          : /hybrid/i.test(value)
            ? "hybrid"
            : "made-to-order";
  const leadTime = value.match(/(\d+)\s*(?:business\s*)?days?/i)?.[1];
  return { model, ...(leadTime ? { leadTimeDays: Number(leadTime) } : {}), notes: value.trim() };
}

function buildBrief(input: IntakeDraft, now: string): VentureBriefValue {
  const slots = input.slots;
  const geographyText = slots.geography.value || input.oneLiner;
  const countryCode = country(geographyText);
  const priceText = slots.price.value;
  const priceModel = /subscription|monthly|weekly|recurring/i.test(priceText)
    ? "subscription"
    : /hour|hourly/i.test(priceText)
      ? "hourly"
      : /project/i.test(priceText)
        ? "per-project"
        : /tier/i.test(priceText)
          ? "tiered"
          : "one-off";
  const commitmentHours = Number(slots.commitment.value.match(/\d+(?:\.\d+)?/)?.[0] ?? 0);
  const serviceRadius = slots.geography.value.match(/(\d+(?:\.\d+)?)\s*km/i)?.[1];

  return VentureBrief.parse({
    oneLiner: input.oneLiner,
    slots: {
      problem: resolved(slots.problem, () => slots.problem.value.trim()),
      customer: resolved(slots.customer, () => slots.customer.value.trim()),
      offer: resolved(slots.offer, () => slots.offer.value.trim()),
      price: resolved(slots.price, () => ({ amountMicros: micros(priceText), currency: currency(`${priceText} ${geographyText}`), model: priceModel, rationale: priceText.trim() }), "offer"),
      differentiation: resolved(slots.differentiation, () => slots.differentiation.value.trim()),
      channel: resolved(slots.channel, () => list(slots.channel.value)),
      economics: resolved(slots.economics, () => ({ notes: slots.economics.value.trim() })),
      capital: resolved(slots.capital, () => ({ amountMicros: micros(slots.capital.value), currency: currency(`${slots.capital.value} ${geographyText}`) })),
      commitment: resolved(slots.commitment, () => ({ hoursPerWeek: Math.min(168, Math.max(0, commitmentHours)) })),
      geography: resolved(slots.geography, () => ({ sellsTo: [countryCode], operatesFrom: countryCode, ...(input.archetype === "service" && serviceRadius ? { serviceRadiusKm: Number(serviceRadius) } : {}), locality: slots.geography.value.trim(), locales: ["en"] })),
      fulfilment: resolved(slots.fulfilment, () => fulfilment(slots.fulfilment.value, input.archetype), "offer"),
      redlines: resolved(slots.redlines, () => list(slots.redlines.value)),
    },
    archetypeHint: { archetype: input.archetype, confidence: 0.85, reasoning: "Selected from the completed intake and confirmed in the build-plan preview." },
    tensions: [],
    ownershipDisclosureAcceptedAt: now,
    createdAt: now,
  });
}

function ventureName(input: IntakeDraft): string {
  const source = input.slots.offer.status === "answered" ? input.slots.offer.value : input.oneLiner;
  const cleaned = source.trim().replace(/^I\s+(?:want|would like)\s+to\s+/i, "").replace(/[.!?].*$/s, "");
  const named = cleaned || `New ${input.archetype} venture`;
  return named.length > 72 ? `${named.slice(0, 69).trimEnd()}…` : named;
}

export interface IntakeRunReceipt {
  runId: string;
  ventureId: string;
  jobId: string;
  url: string;
  created: boolean;
}

const queue = new PostgresJobQueue({ workerId: "web-intake" });

export async function createIntakeRun(input: IntakeDraft): Promise<IntakeRunReceipt> {
  const environment = config();
  const persisted = await withSessionAccount(async (tx, session) => {
    const idempotencyKey = `intake:${session.accountId}:${input.idempotencyKey}`;
    const accountRaw = rowsOf<unknown>(await tx.execute(sql`
      SELECT a.status, a.autonomy_default, p.entitlements, p.active AS plan_active
      FROM accounts a JOIN plans p ON p.id = a.plan_id
      WHERE a.id = ${session.accountId}
    `))[0];
    const account = AccountRow.safeParse(accountRaw);
    if (!account.success || account.data.status === "suspended" || account.data.status === "closed" || !account.data.plan_active) {
      throw new IntakeCommandError("account_unavailable", "This account cannot start a build right now.", 403);
    }
    // The run's unique key is the final backstop. The transaction lock makes
    // two simultaneous browser retries converge before either creates a
    // venture, so the loser does not leave an orphan row behind.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`);

    const existingRaw = rowsOf<unknown>(await tx.execute(sql`
      SELECT r.id AS run_id, r.venture_id, r.playbook_id
      FROM runs r JOIN ventures v ON v.id = r.venture_id
      WHERE r.idempotency_key = ${idempotencyKey} AND v.account_id = ${session.accountId}
      LIMIT 1
    `))[0];
    const existing = ExistingRun.safeParse(existingRaw);
    if (existing.success) return { runId: existing.data.run_id, ventureId: existing.data.venture_id, created: false };

    const entitled = { entitlements: account.data.entitlements };
    const playbook = requirePlaybook(playbookFor[input.archetype]);
    const active = CountRow.parse(rowsOf<unknown>(await tx.execute(sql`
      SELECT count(*)::int AS count FROM ventures
      WHERE account_id = ${session.accountId} AND status NOT IN ('archived', 'transferred')
    `))[0]).count;
    const requiredCredits = Math.ceil(playbook.estimatedCostMicros / 1_000);
    if (!can(entitled, "ventures.max", active + 1)) {
      throw new IntakeCommandError("entitlement_denied", "This plan has reached its active-venture limit.", 403);
    }
    if (!can(entitled, "playbooks.allowed", playbook.id)) {
      throw new IntakeCommandError("entitlement_denied", "This plan does not include the selected playbook.", 403);
    }
    if (!can(entitled, "autonomy.max", account.data.autonomy_default)) {
      throw new IntakeCommandError("entitlement_denied", "The account's default autonomy exceeds its current plan.", 403);
    }
    if (!can(entitled, "credits.weekly", requiredCredits)) {
      throw new IntakeCommandError("entitlement_denied", "The build estimate exceeds this plan's weekly credit allowance.", 403);
    }

    const now = new Date().toISOString();
    const brief = buildBrief(input, now);
    const ventureId = randomUUID();
    const runId = randomUUID();
    await tx.execute(sql`
      INSERT INTO ventures (id, account_id, name, archetype, status, ownership_mode, brief)
      VALUES (${ventureId}, ${session.accountId}, ${ventureName(input)}, ${input.archetype}, 'building', 'managed', ${JSON.stringify(brief)}::jsonb)
    `);
    await tx.execute(sql`
      INSERT INTO runs (id, venture_id, playbook_id, playbook_version, status, autonomy,
        budget_micros, spent_micros, seed, sandbox, idempotency_key)
      VALUES (${runId}, ${ventureId}, ${playbook.id}, ${playbook.version}, 'queued',
        ${account.data.autonomy_default}, ${playbook.estimatedCostMicros}, 0,
        ${input.idempotencyKey}, ${environment.sandbox}, ${idempotencyKey})
    `);
    await tx.execute(sql`
      INSERT INTO audit_log (account_id, actor, action, subject_type, subject_id, metadata)
      VALUES (${session.accountId}, ${`user:${session.userId}`}, 'venture.intake_submitted', 'run', ${runId},
        ${JSON.stringify({ ventureId, playbookId: playbook.id, autonomy: account.data.autonomy_default })}::jsonb)
    `);
    return { runId, ventureId, created: true };
  });

  try {
    const jobId = await queue.enqueue(
      "run.execute",
      { runId: persisted.runId, autoApproveSandboxCheckpoints: true },
      { idempotencyKey: `run:${persisted.runId}`, maxAttempts: 3 },
    );
    return { ...persisted, jobId, url: `/runs/${persisted.runId}` };
  } catch (error) {
    throw new IntakeCommandError(
      "queue_unavailable",
      "The run was saved but the worker queue is unavailable. This request can be retried safely.",
      503,
    );
  }
}
