import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfigCache } from "@kiln/config";
import { asServiceRole, closeDb, getDb } from "@kiln/db";
import { applySchema } from "@kiln/db/migrate";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MockBillingAdapter } from "../adapters.js";
import { PLAN_CATALOGUE } from "../plans.js";
import { startCheckout, startCustomerPortal } from "../service.js";
import type { BillingAdapter } from "../types.js";

const temp = mkdtempSync(join(tmpdir(), "kiln-billing-service-"));
const accountId = "00000000-0000-4000-8000-000000000021";
const emptyAccountId = "00000000-0000-4000-8000-000000000022";
const planId = "00000000-0000-4000-8000-000000000023";

beforeAll(async () => {
  process.env["KILN_PGDATA"] = join(temp, "pgdata");
  resetConfigCache();
  await applySchema();
  const db = await getDb();
  const entitlements = JSON.stringify(PLAN_CATALOGUE[0]!.entitlements);
  await asServiceRole(db, async (tx) => {
    await tx.execute(sql`
      INSERT INTO plans (id, name, price_weekly_cents, entitlements)
      VALUES (${planId}, 'Founder', 19900, ${entitlements}::jsonb)
    `);
    await tx.execute(sql`
      INSERT INTO accounts (id, name, status, stripe_customer_id)
      VALUES (${accountId}, 'Existing customer', 'active', 'cus_existing')
    `);
    await tx.execute(sql`
      INSERT INTO accounts (id, name, status)
      VALUES (${emptyAccountId}, 'New customer', 'trialing')
    `);
  });
});

afterAll(async () => {
  await closeDb();
  delete process.env["KILN_PGDATA"];
  resetConfigCache();
  rmSync(temp, { recursive: true, force: true });
});

describe("billing service", () => {
  it("loads the active plan and forwards an existing customer to checkout", async () => {
    const adapter = new MockBillingAdapter();
    const createCheckout = vi.spyOn(adapter, "createCheckout");
    const result = await startCheckout(
      {
        accountId,
        planId,
        customerEmail: "owner@example.test",
        interval: "month",
        successUrl: "https://app.example.test/success",
        cancelUrl: "https://app.example.test/cancel",
      },
      adapter,
    );

    expect(result.simulated).toBe(true);
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        planId,
        planName: "Founder",
        priceWeeklyCents: 19_900,
        customerId: "cus_existing",
        interval: "month",
      }),
    );
  });

  it("uses email checkout for an account without a Stripe customer", async () => {
    const adapter = new MockBillingAdapter();
    const createCheckout = vi.spyOn(adapter, "createCheckout");
    await startCheckout(
      {
        accountId: emptyAccountId,
        planId,
        customerEmail: "new@example.test",
        interval: "year",
        successUrl: "https://app.example.test/success",
        cancelUrl: "https://app.example.test/cancel",
      },
      adapter,
    );
    expect(createCheckout.mock.calls[0]?.[0]).not.toHaveProperty("customerId");
    expect(createCheckout.mock.calls[0]?.[0].customerEmail).toBe("new@example.test");
  });

  it("fails closed when the account or active plan cannot be found", async () => {
    await expect(
      startCheckout(
        {
          accountId,
          planId: "00000000-0000-4000-8000-000000000099",
          customerEmail: "owner@example.test",
          interval: "week",
          successUrl: "https://app.example.test/success",
          cancelUrl: "https://app.example.test/cancel",
        },
        new MockBillingAdapter(),
      ),
    ).rejects.toThrow("Account or active plan not found");
  });

  it("opens the real customer's portal and provides a deterministic mock fallback", async () => {
    const adapter = new MockBillingAdapter();
    const createPortal = vi.spyOn(adapter, "createPortal");
    await startCustomerPortal({ accountId, returnUrl: "https://app.example.test/billing" }, adapter);
    expect(createPortal).toHaveBeenLastCalledWith({
      customerId: "cus_existing",
      returnUrl: "https://app.example.test/billing",
    });

    const fallback = await startCustomerPortal(
      { accountId: emptyAccountId, returnUrl: "https://app.example.test/billing" },
      adapter,
    );
    expect(fallback).toMatchObject({ simulated: true });
    expect(createPortal).toHaveBeenLastCalledWith({
      customerId: `cus_mock_${emptyAccountId}`,
      returnUrl: "https://app.example.test/billing",
    });
  });

  it("refuses a live portal until Stripe has assigned a customer", async () => {
    const liveAdapter: BillingAdapter = {
      kind: "stripe",
      createCheckout: vi.fn(),
      createPortal: vi.fn(),
      verifyWebhook: vi.fn(),
    };
    await expect(
      startCustomerPortal({ accountId: emptyAccountId, returnUrl: "https://app.example.test/billing" }, liveAdapter),
    ).rejects.toThrow("no Stripe customer");
    expect(liveAdapter.createPortal).not.toHaveBeenCalled();
  });
});
