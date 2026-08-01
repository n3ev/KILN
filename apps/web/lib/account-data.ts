import { randomUUID } from "node:crypto";
import { asServiceRole, getDb, rowsOf, type Database } from "@kiln/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { scrubCustomerExport } from "./account-export-scrub";
import { exportFrom, type AccountExport } from "./account-export-query";
import { requireOwnerSession, withSessionAccount } from "./session";

type DataRow = Record<string, unknown>;

export interface AccountDataSummary {
  readonly accountId: string;
  readonly accountName: string;
  readonly status: string;
  readonly createdAt: string;
  readonly ventures: number;
  readonly runs: number;
  readonly artifacts: number;
  readonly liveStripeSubscription: boolean;
}


export interface AccountDeletionReceipt {
  readonly receiptId: string;
  readonly accountId: string;
  readonly deletedAt: string;
  readonly deleted: true;
  readonly removed: {
    readonly users: number;
    readonly ventures: number;
    readonly runs: number;
    readonly artifacts: number;
    readonly assets: number;
    readonly credentials: number;
    readonly eventWaiters: number;
    readonly queuedJobs: number;
    readonly stripeInboxEvents: number;
  };
}

export class AccountDataCommandError extends Error {
  constructor(
    readonly code: "owner_required" | "account_not_found" | "confirmation_mismatch" | "active_subscription",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AccountDataCommandError";
  }
}

const Confirmation = z.object({ confirmation: z.string().min(1).max(200) }).strict();

export { scrubCustomerExport } from "./account-export-scrub";
export type { AccountExport } from "./account-export-query";

export function stringifyAccountExport(value: AccountExport): string {
  return JSON.stringify(scrubCustomerExport(value), null, 2);
}

export async function getAccountDataSummary(): Promise<AccountDataSummary> {
  await requireOwnerSession();
  return withSessionAccount(async (tx, session) => {
    const row = rowsOf<{
      id: string; name: string; status: string; created_at: Date | string;
      ventures: number | string; runs: number | string; artifacts: number | string;
      live_stripe_subscription: boolean;
    }>(await tx.execute(sql`
      SELECT a.id, a.name, a.status, a.created_at,
        (SELECT count(*) FROM ventures v WHERE v.account_id = a.id) AS ventures,
        (SELECT count(*) FROM runs r JOIN ventures v ON v.id = r.venture_id WHERE v.account_id = a.id) AS runs,
        (SELECT count(*) FROM artifacts x JOIN ventures v ON v.id = x.venture_id WHERE v.account_id = a.id) AS artifacts,
        EXISTS (
          SELECT 1 FROM subscriptions s WHERE s.account_id = a.id
            AND s.stripe_subscription_id IS NOT NULL
            AND lower(s.status) NOT IN ('canceled', 'cancelled', 'ended', 'inactive')
        ) AS live_stripe_subscription
      FROM accounts a WHERE a.id = ${session.accountId}
    `))[0];
    if (!row) throw new AccountDataCommandError("account_not_found", "Account not found.", 404);
    return {
      accountId: row.id,
      accountName: row.name,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      ventures: Number(row.ventures),
      runs: Number(row.runs),
      artifacts: Number(row.artifacts),
      liveStripeSubscription: row.live_stripe_subscription,
    };
  });
}

export async function createAccountExport(): Promise<AccountExport> {
  await requireOwnerSession();
  const generatedAt = new Date().toISOString();
  return withSessionAccount((tx, session) => exportFrom(tx, session.accountId, session.userId, generatedAt));
}

interface DeletionIdentity {
  id: string;
  name: string;
  stripe_customer_id: string | null;
}

interface DeletionInventory {
  users: number | string;
  ventures: number | string;
  runs: number | string;
  artifacts: number | string;
  assets: number | string;
  credentials: number | string;
}

/**
 * Deletes the account in one service-role transaction after re-checking the
 * authenticated owner. Service elevation is required only because job_queue,
 * event_waiters and stripe_events intentionally have no customer RLS path.
 */
export async function deleteCurrentAccount(input: unknown): Promise<AccountDeletionReceipt> {
  const request = Confirmation.parse(input);
  const session = await requireOwnerSession();
  const db = await getDb();
  return asServiceRole(db, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`account-delete:${session.accountId}`}))`);
    const identity = rowsOf<DeletionIdentity>(await tx.execute(sql`
      SELECT a.id, a.name, a.stripe_customer_id
      FROM accounts a JOIN users u ON u.account_id = a.id
      WHERE a.id = ${session.accountId} AND u.id = ${session.userId} AND u.role = 'owner'
      FOR UPDATE OF a
    `))[0];
    if (!identity) {
      throw new AccountDataCommandError("owner_required", "The owner identity no longer has access to this account.", 403);
    }
    if (request.confirmation !== identity.name) {
      throw new AccountDataCommandError("confirmation_mismatch", "The confirmation must exactly match the account name.", 409);
    }
    const liveSubscription = rowsOf<{ id: string }>(await tx.execute(sql`
      SELECT id FROM subscriptions
      WHERE account_id = ${identity.id} AND stripe_subscription_id IS NOT NULL
        AND lower(status) NOT IN ('canceled', 'cancelled', 'ended', 'inactive')
      LIMIT 1
    `))[0];
    if (liveSubscription) {
      throw new AccountDataCommandError(
        "active_subscription",
        "Cancel the live Stripe subscription in Billing before deleting this account.",
        409,
      );
    }

    const inventory = rowsOf<DeletionInventory>(await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM users WHERE account_id = ${identity.id}) AS users,
        (SELECT count(*) FROM ventures WHERE account_id = ${identity.id}) AS ventures,
        (SELECT count(*) FROM runs r JOIN ventures v ON v.id = r.venture_id WHERE v.account_id = ${identity.id}) AS runs,
        (SELECT count(*) FROM artifacts a JOIN ventures v ON v.id = a.venture_id WHERE v.account_id = ${identity.id}) AS artifacts,
        (SELECT count(*) FROM assets a JOIN ventures v ON v.id = a.venture_id WHERE v.account_id = ${identity.id}) AS assets,
        (SELECT count(*) FROM credentials c JOIN assets a ON a.id = c.asset_id
          JOIN ventures v ON v.id = a.venture_id WHERE v.account_id = ${identity.id}) AS credentials
    `))[0] ?? { users: 0, ventures: 0, runs: 0, artifacts: 0, assets: 0, credentials: 0 };

    const waiters = rowsOf<{ id: string }>(await tx.execute(sql`
      DELETE FROM event_waiters w
      WHERE EXISTS (
        SELECT 1 FROM runs r JOIN ventures v ON v.id = r.venture_id
        WHERE r.id = w.run_id AND v.account_id = ${identity.id}
      )
      RETURNING id
    `));

    const linkedStripePredicate = sql`
      e.payload #>> '{data,object,client_reference_id}' = ${identity.id}
        OR e.payload #>> '{data,object,metadata,kiln_account_id}' = ${identity.id}
        OR (${identity.stripe_customer_id}::text IS NOT NULL
          AND e.payload #>> '{data,object,customer}' = ${identity.stripe_customer_id}::text)
        OR e.payload #>> '{data,object,subscription}' IN (
          SELECT stripe_subscription_id FROM subscriptions
          WHERE account_id = ${identity.id} AND stripe_subscription_id IS NOT NULL
        )
        OR (
          e.type LIKE 'customer.subscription.%'
          AND e.payload #>> '{data,object,id}' IN (
            SELECT stripe_subscription_id FROM subscriptions
            WHERE account_id = ${identity.id} AND stripe_subscription_id IS NOT NULL
          )
        )
    `;
    const linkedStripeEvents = rowsOf<{ id: string }>(await tx.execute(sql`
      SELECT e.id FROM stripe_events e WHERE ${linkedStripePredicate}
    `));

    const jobs = rowsOf<{ id: string }>(await tx.execute(sql`
      DELETE FROM job_queue q
      WHERE q.payload->>'accountId' = ${identity.id}
        OR q.payload->>'userId' IN (SELECT id::text FROM users WHERE account_id = ${identity.id})
        OR q.payload->>'ventureId' IN (SELECT id::text FROM ventures WHERE account_id = ${identity.id})
        OR q.payload->>'runId' IN (
          SELECT r.id::text FROM runs r JOIN ventures v ON v.id = r.venture_id WHERE v.account_id = ${identity.id}
        )
        OR q.payload->>'assetId' IN (
          SELECT a.id::text FROM assets a JOIN ventures v ON v.id = a.venture_id WHERE v.account_id = ${identity.id}
        )
        OR q.payload->>'connectionId' IN (
          SELECT c.id::text FROM connections c JOIN ventures v ON v.id = c.venture_id WHERE v.account_id = ${identity.id}
        )
        OR q.payload->>'credentialId' IN (
          SELECT c.id::text FROM credentials c JOIN assets a ON a.id = c.asset_id
            JOIN ventures v ON v.id = a.venture_id WHERE v.account_id = ${identity.id}
        )
        OR q.payload->>'eventId' IN (
          SELECT e.id FROM stripe_events e WHERE ${linkedStripePredicate}
        )
      RETURNING id
    `));

    const stripeEvents = linkedStripeEvents.length === 0
      ? []
      : rowsOf<{ id: string }>(await tx.execute(sql`
          DELETE FROM stripe_events e WHERE ${linkedStripePredicate} RETURNING id
        `));

    // Append-only history needs an explicit, service-only erasure permit. The
    // permit is bound to this transaction id and target account; ordinary
    // service-role deletes still fail. Delete these two histories while their
    // ownership joins remain present, then let all other rows cascade.
    await tx.execute(sql`
      INSERT INTO kiln.account_deletion_permits (transaction_id, account_id)
      VALUES (txid_current(), ${identity.id})
    `);
    await tx.execute(sql`
      DELETE FROM run_events e USING runs r, ventures v
      WHERE e.run_id = r.id AND r.venture_id = v.id AND v.account_id = ${identity.id}
    `);
    await tx.execute(sql`DELETE FROM audit_log WHERE account_id = ${identity.id}`);
    const removed = rowsOf<{ id: string }>(await tx.execute(sql`
      DELETE FROM accounts WHERE id = ${identity.id} RETURNING id
    `));
    if (removed.length !== 1) {
      throw new AccountDataCommandError("account_not_found", "Account deletion did not complete.", 404);
    }
    await tx.execute(sql`
      DELETE FROM kiln.account_deletion_permits WHERE transaction_id = txid_current()
    `);

    return {
      receiptId: randomUUID(),
      accountId: identity.id,
      deletedAt: new Date().toISOString(),
      deleted: true,
      removed: {
        users: Number(inventory.users),
        ventures: Number(inventory.ventures),
        runs: Number(inventory.runs),
        artifacts: Number(inventory.artifacts),
        assets: Number(inventory.assets),
        credentials: Number(inventory.credentials),
        eventWaiters: waiters.length,
        queuedJobs: jobs.length,
        stripeInboxEvents: stripeEvents.length,
      },
    };
  });
}
