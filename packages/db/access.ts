import { sql } from "drizzle-orm";
import { rowsOf, type Database } from "./client.js";

export type AccountResource = "venture" | "run" | "artifact" | "checkpoint" | "asset";

export class AccountAccessDenied extends Error {
  constructor(readonly resource: AccountResource) {
    // Do not include the id: callers should not turn an authorisation failure
    // into a cross-tenant existence oracle.
    super(`${resource} is not available to this account`);
    this.name = "AccountAccessDenied";
  }
}

async function accessExists(
  db: Database,
  accountId: string,
  resource: AccountResource,
  resourceId: string,
): Promise<boolean> {
  const query = (() => {
    switch (resource) {
      case "venture":
        return sql`SELECT 1 AS allowed FROM ventures WHERE id = ${resourceId} AND account_id = ${accountId}`;
      case "run":
        return sql`SELECT 1 AS allowed FROM runs r JOIN ventures v ON v.id = r.venture_id WHERE r.id = ${resourceId} AND v.account_id = ${accountId}`;
      case "artifact":
        return sql`SELECT 1 AS allowed FROM artifacts a JOIN ventures v ON v.id = a.venture_id WHERE a.id = ${resourceId} AND v.account_id = ${accountId}`;
      case "checkpoint":
        return sql`SELECT 1 AS allowed FROM checkpoints c JOIN runs r ON r.id = c.run_id JOIN ventures v ON v.id = r.venture_id WHERE c.id = ${resourceId} AND v.account_id = ${accountId}`;
      case "asset":
        return sql`SELECT 1 AS allowed FROM assets a JOIN ventures v ON v.id = a.venture_id WHERE a.id = ${resourceId} AND v.account_id = ${accountId}`;
    }
  })();
  return rowsOf<{ allowed: number }>(await db.execute(query)).length === 1;
}

/**
 * Application-layer tenant guard. Use it before every mutation addressed by a
 * resource id; RLS remains the independent database backstop.
 */
export async function assertAccountAccess(
  db: Database,
  accountId: string,
  resource: AccountResource,
  resourceId: string,
): Promise<void> {
  if (!await accessExists(db, accountId, resource, resourceId)) throw new AccountAccessDenied(resource);
}
