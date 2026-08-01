import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HumanDirectiveReceipt, HumanDirectiveRequest, RunEvent } from "@kiln/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.kiln/web-interventions-test-pgdata");
process.env["KILN_PGDATA"] = testDataDir;

const accountId = randomUUID();
const foreignAccountId = randomUUID();
const userId = randomUUID();
const ventureId = randomUUID();
const foreignVentureId = randomUUID();
const runId = randomUUID();
const foreignRunId = randomUUID();

let dbModule: typeof import("@kiln/db");
let interventions: typeof import("../lib/interventions");
let interventionRoute: typeof import("../app/api/runs/[runId]/interventions/route");

beforeAll(async () => {
  rmSync(testDataDir, { recursive: true, force: true });
  dbModule = await import("@kiln/db");
  const { applySchema } = await import("@kiln/db/migrate");
  await applySchema();
  const db = await dbModule.getDb();
  await dbModule.asServiceRole(db, async (tx) => {
    await tx.execute(sql`
      INSERT INTO accounts (id, name, status)
      VALUES (${accountId}, 'Directive member account', 'active'),
             (${foreignAccountId}, 'Foreign directive account', 'active')
    `);
    await tx.execute(sql`
      INSERT INTO users (id, account_id, email, name, role)
      VALUES (${userId}, ${accountId}, 'demo@kiln.local', 'Member', 'member')
    `);
    await tx.execute(sql`
      INSERT INTO ventures (id, account_id, name, archetype, brief)
      VALUES (${ventureId}, ${accountId}, 'Member venture', 'digital', '{"oneLiner":"Member venture"}'::jsonb),
             (${foreignVentureId}, ${foreignAccountId}, 'Foreign venture', 'digital', '{"oneLiner":"Foreign venture"}'::jsonb)
    `);
    await tx.execute(sql`
      INSERT INTO runs (id, venture_id, playbook_id, playbook_version, status, seed)
      VALUES (${runId}, ${ventureId}, 'digital-product', '1.0.0', 'queued', 'member-directive'),
             (${foreignRunId}, ${foreignVentureId}, 'digital-product', '1.0.0', 'queued', 'foreign-directive')
    `);
  });
  interventions = await import("../lib/interventions");
  interventionRoute = await import("../app/api/runs/[runId]/interventions/route");
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(testDataDir, { recursive: true, force: true });
});

describe("Run Theatre intervention command", () => {
  it("lets a member append an idempotent, audited directive to their run", async () => {
    const input = HumanDirectiveRequest.parse({
      directiveId: randomUUID(),
      directive: "  Remove the third product from the first launch.  ",
    });
    const receipt = await interventions.submitRunDirective(runId, input);
    const retry = await interventions.submitRunDirective(runId, input);

    expect(retry).toEqual(receipt);
    expect(receipt).toMatchObject({ runId, directiveId: input.directiveId, applyAt: "current_phase", status: "queued" });

    const db = await dbModule.getDb();
    const rows = await dbModule.asServiceRole(db, async (tx) => dbModule.rowsOf<{
      payload: unknown;
      event_count: number | string | bigint;
      audit_count: number | string | bigint;
    }>(await tx.execute(sql`
      SELECT min(e.payload::text)::jsonb AS payload,
        count(DISTINCT e.id)::bigint AS event_count,
        count(DISTINCT l.id)::bigint AS audit_count
      FROM run_events e
      LEFT JOIN audit_log l ON l.subject_id = e.run_id::text AND l.action = 'run.directive.submitted'
      WHERE e.run_id = ${runId} AND e.type = 'human_directive'
      GROUP BY e.run_id
    `)));
    expect(Number(rows[0]?.event_count)).toBe(1);
    expect(Number(rows[0]?.audit_count)).toBe(1);
    expect(RunEvent.parse(rows[0]?.payload)).toMatchObject({
      type: "human_directive",
      directive: "Remove the third product from the first launch.",
      byUserId: userId,
    });
  });

  it("queues active-phase instructions for the following boundary", async () => {
    const db = await dbModule.getDb();
    await dbModule.asServiceRole(db, async (tx) => {
      await tx.execute(sql`UPDATE runs SET status = 'running', current_phase = 'offer' WHERE id = ${runId}`);
    });
    const receipt = await interventions.submitRunDirective(runId, HumanDirectiveRequest.parse({
      directiveId: randomUUID(),
      directive: "Use a warmer colour direction in the storefront.",
    }));
    expect(receipt).toMatchObject({ applyAt: "next_phase", receivedPhaseKey: "offer" });
  });

  it("returns the persisted typed receipt through the API boundary", async () => {
    const response = await interventionRoute.POST(new Request(`https://kiln.test/api/runs/${runId}/interventions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.8" },
      body: JSON.stringify({
        directiveId: randomUUID(),
        directive: "Keep the comparison table concise and factual.",
      }),
    }), { params: Promise.resolve({ runId }) });
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(HumanDirectiveReceipt.parse(await response.json())).toMatchObject({
      runId,
      applyAt: "next_phase",
      receivedPhaseKey: "offer",
    });
  });

  it("does not expose or mutate a foreign account's run", async () => {
    await expect(interventions.submitRunDirective(foreignRunId, HumanDirectiveRequest.parse({
      directiveId: randomUUID(),
      directive: "This must not cross the tenant boundary.",
    }))).rejects.toMatchObject({ name: "AccountAccessDenied" });
  });

  it("rejects new instructions after the run is terminal", async () => {
    const db = await dbModule.getDb();
    await dbModule.asServiceRole(db, async (tx) => {
      await tx.execute(sql`UPDATE runs SET status = 'succeeded', ended_at = now() WHERE id = ${runId}`);
    });
    await expect(interventions.submitRunDirective(runId, HumanDirectiveRequest.parse({
      directiveId: randomUUID(),
      directive: "This instruction arrived too late.",
    }))).rejects.toMatchObject({ code: "run_terminal" });
  });
});
