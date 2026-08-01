import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfigCache } from "@kiln/config";
import { asServiceRole, closeDb, getDb, rowsOf } from "@kiln/db";
import { applySchema } from "@kiln/db/migrate";
import { MemoryJobQueue } from "@kiln/jobs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockBillingAdapter } from "../adapters.js";
import { processStripeEvent } from "../processor.js";
import { receiveStripeWebhook } from "../service.js";
import type { StripeEvent } from "../types.js";

const temp = mkdtempSync(join(tmpdir(), "kiln-billing-"));
const accountId = "00000000-0000-4000-8000-000000000011";
const planId = "00000000-0000-4000-8000-000000000012";

beforeAll(async () => {
  process.env["KILN_PGDATA"] = join(temp, "pgdata");
  resetConfigCache();
  await applySchema();
  const db = await getDb();
  await asServiceRole(db, async (tx) => {
    await tx.execute(sql`
      INSERT INTO plans (id, name, price_weekly_cents, entitlements)
      VALUES (${planId}, 'Test', 1000, '{}'::jsonb)
    `);
    await tx.execute(sql`INSERT INTO accounts (id, name, status) VALUES (${accountId}, 'Billing Test', 'trialing')`);
  });
});

afterAll(async () => {
  await closeDb();
  delete process.env["KILN_PGDATA"];
  resetConfigCache();
  rmSync(temp, { recursive: true, force: true });
});

describe("Stripe inbox", () => {
  it("deduplicates replay and processes the queued event once", async () => {
    const adapter = new MockBillingAdapter("webhook-test-secret");
    const queue = new MemoryJobQueue();
    const event: StripeEvent = {
      id: "evt_checkout_once",
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1_000),
      livemode: false,
      data: {
        object: {
          client_reference_id: accountId,
          customer: "cus_test_once",
          subscription: "sub_test_once",
          metadata: { kiln_account_id: accountId, kiln_plan_id: planId },
        },
      },
    };
    const raw = JSON.stringify(event);
    const signature = adapter.signWebhook(raw);
    const first = await receiveStripeWebhook(raw, signature, queue, adapter);
    const replay = await receiveStripeWebhook(raw, signature, queue, adapter);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.jobId).toBe(first.jobId);

    expect(await processStripeEvent(event.id)).toBe(true);
    expect(await processStripeEvent(event.id)).toBe(false);

    const db = await getDb();
    const { inbox, subscriptions } = await asServiceRole(db, async (tx) => ({
      inbox: rowsOf<{ status: string }>(
        await tx.execute(sql`SELECT status FROM stripe_events WHERE id = ${event.id}`),
      ),
      subscriptions: rowsOf<{ n: number }>(
        await tx.execute(sql`SELECT count(*)::int AS n FROM subscriptions WHERE stripe_subscription_id = 'sub_test_once'`),
      ),
    }));
    expect(inbox[0]?.status).toBe("processed");
    expect(subscriptions[0]?.n).toBe(1);
  });
});
