import { asServiceRole, getDb, rowsOf, withAccount, type Database } from "@kiln/db";
import type { JobQueue } from "@kiln/jobs";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createBillingAdapter } from "./adapters.js";
import { migrateEntitlements } from "@kiln/contracts";
import type { BillingAdapter, BillingInterval, CheckoutResult } from "./types.js";

export interface StartCheckoutInput {
  readonly accountId: string;
  readonly planId: string;
  readonly customerEmail: string;
  readonly interval: BillingInterval;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export async function startCheckout(
  input: StartCheckoutInput,
  adapter: BillingAdapter = createBillingAdapter(),
  database?: Database,
): Promise<CheckoutResult> {
  const db = database ?? (await getDb());
  const rows = await withAccount(db, input.accountId, async (tx) =>
    rowsOf<{
      stripe_customer_id: string | null;
      plan_name: string;
      price_weekly_cents: number;
      entitlements: unknown;
    }>(
      await tx.execute(sql`
        SELECT account.stripe_customer_id, plan.name AS plan_name,
               plan.price_weekly_cents, plan.entitlements
        FROM accounts AS account
        CROSS JOIN plans AS plan
        WHERE account.id = ${input.accountId} AND plan.id = ${input.planId} AND plan.active = true
        LIMIT 1
      `),
    ),
  );
  const row = rows[0];
  if (!row) throw new Error("Account or active plan not found");
  migrateEntitlements(row.entitlements);

  return adapter.createCheckout({
    accountId: input.accountId,
    planId: input.planId,
    planName: row.plan_name,
    priceWeeklyCents: Number(row.price_weekly_cents),
    customerEmail: input.customerEmail,
    ...(row.stripe_customer_id ? { customerId: row.stripe_customer_id } : {}),
    interval: input.interval,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
}

export async function startCustomerPortal(
  input: { accountId: string; returnUrl: string },
  adapter: BillingAdapter = createBillingAdapter(),
  database?: Database,
): Promise<{ url: string; simulated: boolean }> {
  const db = database ?? (await getDb());
  const rows = await withAccount(db, input.accountId, async (tx) =>
    rowsOf<{ stripe_customer_id: string | null }>(
      await tx.execute(sql`SELECT stripe_customer_id FROM accounts WHERE id = ${input.accountId} LIMIT 1`),
    ),
  );
  const customerId = rows[0]?.stripe_customer_id;
  if (!customerId) {
    if (adapter.kind === "mock") {
      return adapter.createPortal({ customerId: `cus_mock_${input.accountId}`, returnUrl: input.returnUrl });
    }
    throw new Error("The account has no Stripe customer yet");
  }
  return adapter.createPortal({ customerId, returnUrl: input.returnUrl });
}

export interface WebhookReceipt {
  readonly eventId: string;
  readonly replayed: boolean;
  readonly jobId: string;
}

/** Verifies, durably records, then asynchronously dispatches a Stripe event. */
export async function receiveStripeWebhook(
  rawBody: string,
  signature: string,
  queue: JobQueue,
  adapter: BillingAdapter = createBillingAdapter(),
  database?: Database,
): Promise<WebhookReceipt> {
  const event = adapter.verifyWebhook(rawBody, signature);
  const db = database ?? (await getDb());
  const inserted = await asServiceRole(db, async (tx) =>
    rowsOf<{ id: string }>(
      await tx.execute(sql`
        INSERT INTO stripe_events (id, type, payload, livemode, status)
        VALUES (${event.id}, ${event.type}, ${JSON.stringify(event)}::jsonb, ${event.livemode}, 'received')
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `),
    ),
  );

  // Always enqueue: if a process died after the inbox insert but before this
  // call, provider replay repairs it. The queue key makes this a single job.
  const jobId = await queue.enqueue(
    "billing.stripe-event",
    { eventId: event.id },
    { idempotencyKey: `stripe:${event.id}`, maxAttempts: 8 },
  );
  await asServiceRole(db, async (tx) => {
    await tx.execute(sql`
      UPDATE stripe_events SET status = CASE WHEN status = 'received' THEN 'queued' ELSE status END
      WHERE id = ${event.id}
    `);
  });
  return { eventId: event.id, replayed: inserted.length === 0, jobId };
}

export const StripeJobPayload = z.object({ eventId: z.string().min(1) });

