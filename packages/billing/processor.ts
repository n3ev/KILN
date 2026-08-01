import { asServiceRole, getDb, rowsOf, type Database } from "@kiln/db";
import type { DurableJob, JobHandler } from "@kiln/jobs";
import { sql } from "drizzle-orm";
import { StripeEvent, type StripeEvent as StripeEventValue } from "./types.js";
import { promptOneLifecycleHooks, type BillingLifecycleHooks } from "./lifecycle.js";
import { StripeJobPayload } from "./service.js";

function field(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function seconds(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1_000).toISOString()
    : undefined;
}

function metadata(object: Record<string, unknown>): Record<string, unknown> {
  const value = object["metadata"];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function upsertSubscription(
  tx: Database,
  event: StripeEventValue,
): Promise<string | undefined> {
  const object = event.data.object;
  const meta = metadata(object);
  const accountId = field(meta, "kiln_account_id") ?? field(object, "client_reference_id");
  const planId = field(meta, "kiln_plan_id");
  const subscriptionId = event.type === "checkout.session.completed"
    ? field(object, "subscription")
    : field(object, "id");
  const customerId = field(object, "customer");

  if (accountId && customerId) {
    await tx.execute(sql`UPDATE accounts SET stripe_customer_id = ${customerId} WHERE id = ${accountId}`);
  }
  if (!accountId || !planId || !subscriptionId) return accountId;

  const status = event.type === "customer.subscription.deleted"
    ? "canceled"
    : field(object, "status") ?? "active";
  const periodEnd = seconds(object["current_period_end"]);
  const cancelAt = seconds(object["cancel_at"]);

  await tx.execute(sql`
    INSERT INTO subscriptions
      (account_id, plan_id, stripe_subscription_id, status, current_period_end, cancel_at)
    VALUES
      (${accountId}, ${planId}, ${subscriptionId}, ${status}, ${periodEnd ?? null}, ${cancelAt ?? null})
    ON CONFLICT (stripe_subscription_id) DO UPDATE SET
      plan_id = EXCLUDED.plan_id,
      status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      cancel_at = EXCLUDED.cancel_at
  `);
  if (event.type !== "customer.subscription.deleted") {
    await tx.execute(sql`UPDATE accounts SET plan_id = ${planId}, status = 'active' WHERE id = ${accountId}`);
  }
  return accountId;
}

async function updateInvoiceState(tx: Database, event: StripeEventValue): Promise<string | undefined> {
  const object = event.data.object;
  const customerId = field(object, "customer");
  const subscriptionId = field(object, "subscription");
  const paid = event.type === "invoice.paid";
  if (subscriptionId) {
    await tx.execute(sql`
      UPDATE subscriptions SET status = ${paid ? "active" : "past_due"}
      WHERE stripe_subscription_id = ${subscriptionId}
    `);
  }
  if (!customerId) return undefined;
  const rows = rowsOf<{ id: string }>(
    await tx.execute(sql`
      UPDATE accounts SET status = ${paid ? "active" : "past_due"}
      WHERE stripe_customer_id = ${customerId}
      RETURNING id
    `),
  );
  return rows[0]?.id;
}

async function applyEvent(
  tx: Database,
  event: StripeEventValue,
  hooks: BillingLifecycleHooks,
): Promise<string | undefined> {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const accountId = await upsertSubscription(tx, event);
    if (event.type !== "checkout.session.completed") await hooks.onSubscriptionChanged(event);
    return accountId;
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const accountId = await updateInvoiceState(tx, event);
    if (event.type === "invoice.paid") await hooks.onInvoicePaid(event);
    else await hooks.onPaymentFailed(event);
    return accountId;
  }
  if (event.type === "customer.subscription.trial_will_end") {
    await hooks.onTrialWillEnd(event);
  }
  return undefined;
}

/** Applies one inbox event exactly once; safe to call again after worker retry. */
export async function processStripeEvent(
  eventId: string,
  hooks: BillingLifecycleHooks = promptOneLifecycleHooks,
  database?: Database,
): Promise<boolean> {
  const db = database ?? (await getDb());
  try {
    return await asServiceRole(db, async (tx) => {
      const row = rowsOf<{ payload: unknown; status: string }>(
        await tx.execute(sql`SELECT payload, status FROM stripe_events WHERE id = ${eventId} FOR UPDATE`),
      )[0];
      if (!row) throw new Error(`Stripe event ${eventId} was not found`);
      if (row.status === "processed") return false;
      const event = StripeEvent.parse(row.payload);
      const accountId = await applyEvent(tx, event, hooks);
      if (accountId) {
        await tx.execute(sql`
          INSERT INTO audit_log (account_id, actor, action, subject_type, subject_id, metadata)
          VALUES (${accountId}, 'system', ${`billing.${event.type}`}, 'stripe_event', ${event.id}, '{}'::jsonb)
        `);
      }
      await tx.execute(sql`
        UPDATE stripe_events SET status = 'processed', processed_at = now(), last_error = NULL
        WHERE id = ${event.id}
      `);
      return true;
    });
  } catch (error) {
    await asServiceRole(db, async (tx) => {
      const body = JSON.stringify({ message: error instanceof Error ? error.message : String(error) });
      await tx.execute(sql`UPDATE stripe_events SET status = 'failed', last_error = ${body}::jsonb WHERE id = ${eventId}`);
    });
    throw error;
  }
}

export function stripeEventJobHandler(
  hooks: BillingLifecycleHooks = promptOneLifecycleHooks,
  database?: Database,
): JobHandler {
  return async (job: DurableJob) => {
    const payload = StripeJobPayload.parse(job.payload);
    await processStripeEvent(payload.eventId, hooks, database);
  };
}

