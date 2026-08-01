import { config } from "@kiln/config";
import { getDb, rowsOf, withAccount, type Database } from "@kiln/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

const OfflineIdentity = z.object({
  id: z.string().uuid(),
  account_id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: z.enum(["owner", "member", "admin"]),
});

export interface AppSession {
  readonly userId: string;
  readonly accountId: string;
  readonly email: string;
  readonly name: string;
  readonly role: "owner" | "member" | "admin";
  readonly mode: "offline";
}

export class SessionAccessError extends Error {
  constructor(
    readonly code: "owner_required" | "operator_required",
    message: string,
  ) {
    super(message);
    this.name = "SessionAccessError";
  }
}

export function assertOwnerSession(session: AppSession): AppSession {
  if (session.role !== "owner") {
    throw new SessionAccessError("owner_required", "Only the account owner can perform this action.");
  }
  return session;
}

let offlineSession: Promise<AppSession> | undefined;

async function loadOfflineSession(): Promise<AppSession> {
  const db = await getDb();
  // This is the authentication lookup, not a tenant data read. The email is a
  // unique seed identity and no customer-controlled value reaches the query.
  const row = rowsOf<unknown>(
    await db.execute(sql`
      SELECT id, account_id, email, name, role
      FROM users
      WHERE email = 'demo@kiln.local'
      LIMIT 1
    `),
  )[0];
  const identity = OfflineIdentity.safeParse(row);
  if (!identity.success) {
    throw new Error("The offline session is unavailable. Run `pnpm db:push && pnpm seed` first.");
  }
  return {
    userId: identity.data.id,
    accountId: identity.data.account_id,
    email: identity.data.email,
    name: identity.data.name ?? "Demo owner",
    role: identity.data.role,
    mode: "offline",
  };
}

/**
 * Prompt 1's zero-key session bridge.
 *
 * Offline/sandbox mode authenticates as the unique seeded demo user. It never
 * silently becomes a production bypass: disabling sandbox mode closes this
 * bridge until the Supabase session adapter is configured in the later prompt.
 */
export async function requireSession(): Promise<AppSession> {
  const environment = config();
  if (!environment.sandbox && !environment.embeddedDatabase) {
    throw new Error("No authenticated Supabase session was supplied.");
  }
  offlineSession ??= loadOfflineSession();
  return offlineSession;
}

export async function requireOperatorSession(): Promise<AppSession> {
  const session = await requireSession();
  // The seeded owner is the local operator; ordinary members never inherit
  // console access merely because the process is running offline.
  if (session.role !== "owner" && session.role !== "admin") {
    throw new SessionAccessError("operator_required", "Operator access required.");
  }
  return session;
}

export async function requireOwnerSession(): Promise<AppSession> {
  return assertOwnerSession(await requireSession());
}

export async function withSessionAccount<T>(
  fn: (tx: Database, session: AppSession) => Promise<T>,
): Promise<T> {
  const session = await requireSession();
  const db = await getDb();
  return withAccount(db, session.accountId, (tx) => fn(tx, session));
}
