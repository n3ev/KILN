import "./load-env.js";
import { sql } from "drizzle-orm";
import { closeDb, getDb, rowsOf } from "../client.js";

/**
 * `pnpm db:doctor`
 *
 * Answers one question: can the connecting role assume the two roles that
 * every request and every worker poll depends on?
 *
 * `client.ts` opens each tenant transaction with SET LOCAL ROLE authenticated
 * and each worker transaction with SET LOCAL ROLE service_role. Postgres
 * permits that only for a superuser or for a member of the target role, and
 * `policies/0004_grants.sql` grants privileges TO those roles without granting
 * MEMBERSHIP of them to anyone. Embedded PGlite connects as a superuser, so the
 * gap cannot appear offline; it surfaces the first time DATABASE_URL points at
 * a real server owned by an ordinary role.
 *
 * Drizzle surfaces the failure as "Failed query: SET LOCAL ROLE service_role"
 * and discards the Postgres error beneath it, which is the part that says why.
 * This prints that part.
 */

interface RoleRow {
  rolname: string;
  rolbypassrls: boolean;
  is_member: boolean;
}

/** The Postgres error is the useful part; drizzle buries it one level down. */
function rootCause(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    const next = (current as { cause?: unknown } | null)?.cause;
    if (next === undefined || next === null) break;
    current = next;
  }
  const shaped = current as { code?: string; message?: string } | null;
  const code = shaped?.code === undefined ? "" : ` [${shaped.code}]`;
  return `${shaped?.message ?? String(error)}${code}`;
}

async function main(): Promise<void> {
  const db = await getDb();

  const [identity] = rowsOf<{ who: string; superuser: boolean; createrole: boolean }>(
    await db.execute(sql`
      SELECT current_user AS who, rolsuper AS superuser, rolcreaterole AS createrole
      FROM pg_roles WHERE rolname = current_user
    `),
  );
  const who = identity?.who ?? "unknown";

  console.log(`connected as   ${who}`);
  console.log(`superuser      ${identity?.superuser ?? false}`);
  console.log(`createrole     ${identity?.createrole ?? false}`);
  console.log(`driver         ${process.env["DATABASE_URL"] ? "postgres-js" : "embedded PGlite"}`);

  // Distinguishes "schema never applied here" from "applied, roles missing".
  const [shape] = rowsOf<{ tables: number }>(
    await db.execute(sql`
      SELECT count(*)::int AS tables FROM pg_tables WHERE schemaname = 'public'
    `),
  );
  console.log(`public tables  ${shape?.tables ?? 0}\n`);

  const roles = rowsOf<RoleRow>(
    await db.execute(sql`
      SELECT r.rolname, r.rolbypassrls,
             pg_has_role(current_user, r.oid, 'MEMBER') AS is_member
      FROM pg_roles r
      WHERE r.rolname IN ('authenticated', 'service_role')
      ORDER BY r.rolname
    `),
  );

  for (const name of ["authenticated", "service_role"]) {
    const row = roles.find((r) => r.rolname === name);
    console.log(
      row === undefined
        ? `${name.padEnd(14)} MISSING — policies were never applied here`
        : `${name.padEnd(14)} exists  bypassrls=${row.rolbypassrls}  member=${row.is_member}`,
    );
  }
  console.log("");

  // Attributes describe the roles. Only the transition proves it works.
  const failures: string[] = [];
  for (const role of ["authenticated", "service_role"]) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));
      });
      console.log(`SET ROLE ${role.padEnd(14)} ok`);
    } catch (error) {
      failures.push(role);
      console.log(`SET ROLE ${role.padEnd(14)} FAILED — ${rootCause(error)}`);
    }
  }

  if (failures.length > 0) {
    const missing = failures.filter((r) => !roles.some((row) => row.rolname === r));
    if (missing.length > 0) {
      console.log(
        `\n${missing.join(" and ")} absent: policies were never applied to THIS database.` +
          `\nRun \`pnpm db:push\` with DATABASE_URL pointing here, then \`pnpm seed\`.`,
      );
    } else {
      console.log("\nGrant membership from a superuser session, then re-run:\n");
      for (const role of failures) console.log(`  GRANT ${role} TO ${who};`);
    }
  }

  await closeDb();
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(async (error: unknown) => {
  console.error("db:doctor failed\n", error);
  await closeDb();
  process.exit(1);
});
