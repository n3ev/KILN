import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RunEvent } from "@kiln/contracts";
import { physicalShopify } from "@kiln/playbooks";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@kiln/db";
import { projectRunEvent } from "../run-projector.js";

/**
 * The `building -> live` transition.
 *
 * This is the only writer of a venture's launch, and CLAUDE.md §11.5 says a run
 * cannot reach `live` with any gate failing — so the negative cases matter more
 * than the positive one. Run against a real engine rather than a stub, because
 * what is being asserted is the SQL.
 */

// Own data directory for the same reason rls.test.ts keeps one: this suite must
// never touch the developer database, and it must not pass because a database
// left over from an earlier run happened to hold the right rows.
const here = dirname(fileURLToPath(import.meta.url));
process.env["KILN_PGDATA"] = resolve(here, "../../../.kiln/projector-suite-pgdata");

let db: Database;
let closeDb: typeof import("@kiln/db").closeDb;
let asServiceRole: typeof import("@kiln/db").asServiceRole;
let rowsOf: typeof import("@kiln/db").rowsOf;

const accountId = randomUUID();

beforeAll(async () => {
  rmSync(process.env["KILN_PGDATA"] as string, { recursive: true, force: true });
  const client = await import("@kiln/db");
  const { applySchema } = await import("@kiln/db/migrate");
  ({ closeDb, asServiceRole, rowsOf } = client);
  await applySchema();
  db = await client.getDb();
  await db.execute(sql`INSERT INTO accounts (id, name) VALUES (${accountId}, 'Projector suite')`);
});

afterAll(async () => {
  await closeDb();
});

interface Fixture {
  ventureId: string;
  runId: string;
}

/** One venture and one queued run, plus whatever quality reports a case needs. */
async function seedRun(
  ventureStatus: "building" | "paused" | "archived",
  qualityReports: readonly boolean[],
): Promise<Fixture> {
  const ventureId = randomUUID();
  const runId = randomUUID();
  await asServiceRole(db, async (tx) => {
    await tx.execute(sql`
      INSERT INTO ventures (id, account_id, name, archetype, status, ownership_mode, brief)
      VALUES (${ventureId}, ${accountId}, 'Projector venture', 'physical', ${ventureStatus},
        'managed', ${JSON.stringify({ oneLiner: "seeded for the projector test" })}::jsonb)
    `);
    await tx.execute(sql`
      INSERT INTO runs (id, venture_id, playbook_id, playbook_version, status, autonomy,
        budget_micros, spent_micros, seed, sandbox, idempotency_key)
      VALUES (${runId}, ${ventureId}, ${physicalShopify.id}, ${physicalShopify.version}, 'running',
        'guided', ${physicalShopify.estimatedCostMicros}, 0, ${`projector:${runId}`}, true,
        ${`projector:${runId}`})
    `);
    for (const [index, cleared] of qualityReports.entries()) {
      await tx.execute(sql`
        INSERT INTO artifacts (venture_id, run_id, type, version, status, content, content_hash)
        VALUES (${ventureId}, ${runId}, 'quality_report', ${index + 1}, 'accepted',
          ${JSON.stringify({ clearedForLaunch: cleared })}::jsonb, ${"0".repeat(64)})
      `);
    }
  });
  return { ventureId, runId };
}

async function succeed({ runId }: Fixture): Promise<void> {
  await asServiceRole(db, (tx) =>
    projectRunEvent(tx, runId, RunEvent.parse({ type: "run.succeeded" }), new Date().toISOString()),
  );
}

async function ventureStatus(ventureId: string): Promise<string | undefined> {
  return asServiceRole(db, async (tx) =>
    rowsOf<{ status: string }>(
      await tx.execute(sql`SELECT status::text AS status FROM ventures WHERE id = ${ventureId}`),
    )[0]?.status,
  );
}

describe("run.succeeded projects the venture", () => {
  it("takes a building venture live once its quality report clears launch", async () => {
    const fixture = await seedRun("building", [true]);
    await succeed(fixture);
    expect(await ventureStatus(fixture.ventureId)).toBe("live");
  });

  it("also marks the run succeeded", async () => {
    const fixture = await seedRun("building", [true]);
    await succeed(fixture);
    const status = await asServiceRole(db, async (tx) =>
      rowsOf<{ status: string }>(
        await tx.execute(sql`SELECT status::text AS status FROM runs WHERE id = ${fixture.runId}`),
      )[0]?.status,
    );
    expect(status).toBe("succeeded");
  });

  it("leaves the venture building when the quality report did not clear launch", async () => {
    const fixture = await seedRun("building", [false]);
    await succeed(fixture);
    expect(await ventureStatus(fixture.ventureId)).toBe("building");
  });

  it("leaves the venture building when the run produced no quality report at all", async () => {
    const fixture = await seedRun("building", []);
    await succeed(fixture);
    expect(await ventureStatus(fixture.ventureId)).toBe("building");
  });

  it("reads the newest quality report, so a superseded pass cannot launch a failing run", async () => {
    const fixture = await seedRun("building", [true, false]);
    await succeed(fixture);
    expect(await ventureStatus(fixture.ventureId)).toBe("building");
  });

  it("promotes on a repaired report, where the newest version is the passing one", async () => {
    const fixture = await seedRun("building", [false, true]);
    await succeed(fixture);
    expect(await ventureStatus(fixture.ventureId)).toBe("live");
  });

  it("does not resurrect a paused or archived venture", async () => {
    const paused = await seedRun("paused", [true]);
    const archived = await seedRun("archived", [true]);
    await succeed(paused);
    await succeed(archived);
    expect(await ventureStatus(paused.ventureId)).toBe("paused");
    expect(await ventureStatus(archived.ventureId)).toBe("archived");
  });

  it("is idempotent, so a replayed run.succeeded does not change an already live venture", async () => {
    const fixture = await seedRun("building", [true]);
    await succeed(fixture);
    await succeed(fixture);
    expect(await ventureStatus(fixture.ventureId)).toBe("live");
  });
});
