import { randomUUID } from "node:crypto";
import {
  HumanDirectiveReceipt,
  RunEvent,
  RunId,
  RunStatus,
  type HumanDirectiveApplyAt,
  type HumanDirectiveReceipt as HumanDirectiveReceiptValue,
  type HumanDirectiveRequest,
  type RunStatus as RunStatusValue,
} from "@kiln/contracts";
import { AccountAccessDenied, assertAccountAccess, rowsOf } from "@kiln/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withSessionAccount } from "./session";

const RunRouteRow = z.object({
  status: RunStatus,
  current_phase: z.string().nullable(),
});

const PersistedEventRow = z.object({
  id: z.string().uuid(),
  seq: z.coerce.number().int().nonnegative(),
  payload: z.unknown(),
  created_at: z.union([z.date(), z.string(), z.number()]).transform((value) => new Date(value).toISOString()),
});

export class RunDirectiveCommandError extends Error {
  constructor(
    readonly code: "run_terminal",
    message: string,
  ) {
    super(message);
    this.name = "RunDirectiveCommandError";
  }
}

/** The only safe current-phase case is before any phase has begun. */
export function directiveApplicationFor(
  status: RunStatusValue,
  currentPhase: string | null,
): HumanDirectiveApplyAt {
  return status === "queued" || (status === "running" && currentPhase === null)
    ? "current_phase"
    : "next_phase";
}

function receiptFromRow(runId: string, rowInput: unknown): HumanDirectiveReceiptValue {
  const row = PersistedEventRow.parse(rowInput);
  const event = RunEvent.parse(row.payload);
  if (event.type !== "human_directive") throw new Error("The persisted directive event has an invalid type.");
  return HumanDirectiveReceipt.parse({
    eventId: row.id,
    directiveId: event.directiveId,
    runId,
    seq: row.seq,
    applyAt: event.applyAt,
    ...(event.receivedPhaseKey ? { receivedPhaseKey: event.receivedPhaseKey } : {}),
    status: "queued",
    submittedAt: row.created_at,
  });
}

/**
 * Persists the human event and its tenant-safe audit record atomically. The
 * folded event state is the durable Planner queue; the active or subsequently
 * resumed run consumes it at its next safe phase boundary.
 */
export async function submitRunDirective(
  runId: string,
  input: HumanDirectiveRequest,
): Promise<HumanDirectiveReceiptValue> {
  if (!RunId.safeParse(runId).success) throw new AccountAccessDenied("run");
  return withSessionAccount(async (tx, session) => {
    await assertAccountAccess(tx, session.accountId, "run", runId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${runId}:${input.directiveId}`}))`);

    const existing = rowsOf<unknown>(await tx.execute(sql`
      SELECT id, seq, payload, created_at
      FROM run_events
      WHERE run_id = ${runId}
        AND type = 'human_directive'
        AND payload->>'directiveId' = ${input.directiveId}
      ORDER BY seq ASC
      LIMIT 1
    `))[0];
    if (existing !== undefined) return receiptFromRow(runId, existing);

    const run = RunRouteRow.parse(rowsOf<unknown>(await tx.execute(sql`
      SELECT r.status::text AS status, r.current_phase
      FROM runs r JOIN ventures v ON v.id = r.venture_id
      WHERE r.id = ${runId} AND v.account_id = ${session.accountId}
      FOR UPDATE OF r
    `))[0]);
    if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
      throw new RunDirectiveCommandError("run_terminal", "Completed runs cannot accept new instructions.");
    }

    const applyAt = directiveApplicationFor(run.status, run.current_phase);
    const event = RunEvent.parse({
      type: "human_directive",
      directiveId: input.directiveId,
      directive: input.directive,
      byUserId: session.userId,
      applyAt,
      ...(applyAt === "next_phase" && run.current_phase ? { receivedPhaseKey: run.current_phase } : {}),
    });
    const inserted = rowsOf<unknown>(await tx.execute(sql`
      INSERT INTO run_events (id, run_id, type, payload, actor)
      VALUES (${randomUUID()}, ${runId}, ${event.type}, ${JSON.stringify(event)}::jsonb, 'human')
      RETURNING id, seq, payload, created_at
    `))[0];
    if (inserted === undefined) throw new Error("Persisting the human directive returned no event.");

    const receipt = receiptFromRow(runId, inserted);
    await tx.execute(sql`
      INSERT INTO audit_log (account_id, actor, action, subject_type, subject_id, metadata)
      VALUES (${session.accountId}, ${`user:${session.userId}`}, 'run.directive.submitted', 'run', ${runId},
        ${JSON.stringify({
          eventId: receipt.eventId,
          directiveId: receipt.directiveId,
          applyAt: receipt.applyAt,
          receivedPhaseKey: receipt.receivedPhaseKey ?? null,
        })}::jsonb)
    `);
    return receipt;
  });
}
