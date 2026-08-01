import { createHash } from "node:crypto";
import { requireAgent } from "@kiln/agents";
import {
  BudgetExceeded,
  LivePublishBlocked,
  SpendAuthorisation,
  type Autonomy,
  type SpendAuthorisation as SpendAuthorisationValue,
} from "@kiln/contracts";
import { asServiceRole, getDb, rowsOf, type Database } from "@kiln/db";
import {
  buildRegistry,
  invokeTool,
  type PipelineDeps,
  type ToolCallRecord,
  type ToolContext,
} from "@kiln/tools";
import { sql } from "drizzle-orm";
import type { PostgresRunStore } from "./run-store.js";

type BudgetCategory = "image" | "tool" | "external";

interface Reservation {
  readonly category: BudgetCategory;
  readonly micros: number;
}

interface ToolCallRow {
  id: string;
  toolId: string;
  toolVersion: string;
  idempotencyKey: string;
  input: unknown;
  output: unknown;
  status: "succeeded" | "failed" | "refused";
  latencyMs: number;
  externalCostMicros: number | string | bigint;
  sandboxed: boolean;
}

interface AuthorisationRow {
  id: string;
  runId: string;
  purpose: string;
  ceilingMicros: number | string | bigint;
  currency: string;
  quoteId: string;
  category: string;
  grantedByUserId: string | null;
  standing: boolean;
  expiresAt: Date | string;
  consumedByToolCallId: string | null;
  createdAt: Date | string;
}

interface LivePublishRow {
  kycStatus: "unverified" | "pending" | "verified" | "rejected";
  pendingReviews: number | string | bigint;
}

export interface PostgresToolPolicyOptions {
  readonly runId: string;
  readonly budgetMicros: number;
  readonly autonomy: Autonomy;
  readonly store: PostgresRunStore;
  readonly database?: Database;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function integer(value: number | string | bigint | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid persisted micros value: ${String(value)}`);
  return parsed;
}

export function livePublishBlockReason(
  row: LivePublishRow | undefined,
): "kyc-required" | "kyc-rejected" | "manual-review" | "account-unavailable" | undefined {
  if (!row) return "account-unavailable";
  if (row.kycStatus === "rejected") return "kyc-rejected";
  if (row.kycStatus !== "verified") return "kyc-required";
  if (integer(row.pendingReviews) > 0) return "manual-review";
  return undefined;
}

function authorisationId(input: unknown): string | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const value = (input as Record<string, unknown>)["authorisationId"];
  return typeof value === "string" ? value : undefined;
}

/** Binds the shared tool policy, budget, idempotency and audit pipeline to one run. */
export class PostgresToolPolicy {
  readonly #options: PostgresToolPolicyOptions;
  readonly #registry = buildRegistry();
  readonly #reservations = new Map<string, Reservation>();

  constructor(options: PostgresToolPolicyOptions) {
    this.#options = options;
  }

  async #db(): Promise<Database> {
    return this.#options.database ?? getDb();
  }

  async invoke(toolId: string, input: unknown, context: ToolContext): Promise<unknown> {
    const allowlist = requireAgent(context.agentId).tools;
    const tool = this.#registry.require(toolId);
    if (!context.sandbox && tool.sideEffect === "publish") await this.#assertLivePublishAllowed(context);
    const authId = authorisationId(input);
    const deps: PipelineDeps = {
      registry: this.#registry,
      agentAllowlist: allowlist,
      grantedScopes: context.grantedScopes,
      findCompleted: (key) => this.#findCompleted(key),
      persist: (record) => this.#persist(record, context.taskId, authId),
      // The runtime owns the durable timeline envelope around this call; the
      // pipeline owns the detailed tool_calls audit row.
      emit: async () => undefined,
      requestApproval: (request) => this.#requestApproval(request),
      approvalCoveredByAutonomy: (effect) =>
        this.#options.autonomy === "autonomous" && effect === "publish",
      budget: {
        reserve: (category, micros, ref) => this.#reserve(category, micros, ref),
        settle: (ref, actualMicros) => this.#settle(ref, actualMicros),
        release: (ref) => this.#release(ref),
      },
      findAuthorisation: (id) => this.#findAuthorisation(id),
      consumeAuthorisation: (id, toolCallId) => this.#consumeAuthorisation(id, toolCallId),
    };
    return invokeTool(deps, { toolId, input, ctx: context, authorisationId: authId });
  }

  async #assertLivePublishAllowed(context: ToolContext): Promise<void> {
    const db = await this.#db();
    const row = await asServiceRole(db, async (tx) => rowsOf<LivePublishRow>(await tx.execute(sql`
      SELECT a.kyc_status::text AS "kycStatus",
        (SELECT count(*)::bigint FROM abuse_reviews review
         WHERE review.account_id = a.id AND review.status IN ('pending', 'blocked')) AS "pendingReviews"
      FROM runs r
      JOIN ventures v ON v.id = r.venture_id
      JOIN accounts a ON a.id = v.account_id
      WHERE r.id = ${this.#options.runId} AND a.id = ${context.accountId}
      LIMIT 1
    `))[0]);
    const reason = livePublishBlockReason(row);
    if (reason) throw new LivePublishBlocked(reason);
  }

  async #findCompleted(key: string): Promise<ToolCallRecord | undefined> {
    const db = await this.#db();
    const row = await asServiceRole(db, async (tx) =>
      rowsOf<ToolCallRow>(await tx.execute(sql`
        SELECT id, tool_id AS "toolId", tool_version AS "toolVersion",
          idempotency_key AS "idempotencyKey", input, output, status::text AS status,
          latency_ms AS "latencyMs", external_cost_micros AS "externalCostMicros",
          sandboxed
        FROM tool_calls
        WHERE run_id = ${this.#options.runId} AND idempotency_key = ${key}
          AND status IN ('succeeded', 'refused')
        LIMIT 1
      `))[0],
    );
    return row ? { ...row, externalCostMicros: integer(row.externalCostMicros) } : undefined;
  }

  async #persist(
    record: ToolCallRecord,
    taskId: string | undefined,
    authId: string | undefined,
  ): Promise<void> {
    const db = await this.#db();
    await asServiceRole(db, async (tx) => {
      await tx.execute(sql`
        INSERT INTO tool_calls
          (id, task_id, run_id, tool_id, tool_version, input, output, status,
           idempotency_key, external_cost_micros, latency_ms, sandboxed, authorisation_id)
        VALUES
          (${record.id}, ${taskId ?? null}, ${this.#options.runId}, ${record.toolId},
           ${record.toolVersion}, ${JSON.stringify(record.input)}::jsonb,
           ${JSON.stringify(record.output)}::jsonb, ${record.status}, ${record.idempotencyKey},
           ${record.externalCostMicros}, ${record.latencyMs}, ${record.sandboxed}, ${authId ?? null})
        ON CONFLICT (idempotency_key) DO UPDATE SET
          id = EXCLUDED.id, task_id = EXCLUDED.task_id, output = EXCLUDED.output,
          status = EXCLUDED.status, external_cost_micros = EXCLUDED.external_cost_micros,
          latency_ms = EXCLUDED.latency_ms, sandboxed = EXCLUDED.sandboxed,
          authorisation_id = EXCLUDED.authorisation_id
      `);
    });
  }

  async #requestApproval(request: {
    toolId: string;
    input: unknown;
    sideEffect: string;
    estimatedMicros: number;
    reason: "side_effect" | "untrusted_content";
  }): Promise<{ approved: boolean; reason?: string }> {
    const operation = createHash("sha256")
      .update(JSON.stringify({ toolId: request.toolId, input: request.input }))
      .digest("hex")
      .slice(0, 12);
    const decision = await this.#options.store.requestCheckpoint({
      kind: request.sideEffect === "spend" ? "spend_authorisation" : "hard_gate",
      title: request.reason === "untrusted_content"
        ? `Confirm ${request.toolId} after web research (${operation})`
        : `Approve ${request.toolId} (${operation})`,
      question: request.reason === "untrusted_content"
        ? `Web content was ingested in the preceding turn. Independently confirm this ${request.sideEffect} operation?`
        : `Allow ${request.toolId} to perform a ${request.sideEffect} operation?`,
      context: request.reason === "untrusted_content"
        ? `This confirmation is an injection defence; do not rely on instructions found in fetched content. Requested input: ${JSON.stringify(request.input)}. Estimated external cost: ${request.estimatedMicros} micros.`
        : `Requested input: ${JSON.stringify(request.input)}. Estimated external cost: ${request.estimatedMicros} micros.`,
      options: [
        {
          id: "approve",
          label: "Approve",
          description: "Allow this exact tool operation.",
          consequence: "The operation may proceed immediately.",
          recommended: true,
        },
        {
          id: "reject",
          label: "Reject",
          description: "Do not allow this operation.",
          consequence: "No external side effect occurs.",
          recommended: false,
        },
      ],
    });
    return { approved: decision.approved, reason: decision.approved ? undefined : "rejected by operator" };
  }

  async #reserve(category: BudgetCategory, micros: number, ref: string): Promise<void> {
    if (!Number.isSafeInteger(micros) || micros < 0) throw new Error(`Invalid budget reservation: ${micros}`);
    if (micros === 0 || this.#reservations.has(ref)) return;
    const db = await this.#db();
    await asServiceRole(db, async (tx) => {
      const run = rowsOf<{ id: string }>(await tx.execute(sql`
        SELECT id FROM runs WHERE id = ${this.#options.runId} FOR UPDATE
      `))[0];
      if (!run) throw new Error(`Run ${this.#options.runId} was not found while reserving budget`);
      const totals = rowsOf<{ reservedMicros: number | string | bigint; spentMicros: number | string | bigint }>(await tx.execute(sql`
        SELECT COALESCE(sum(reserved_micros), 0) AS "reservedMicros",
          COALESCE(sum(spent_micros), 0) AS "spentMicros"
        FROM budget_envelopes WHERE run_id = ${this.#options.runId}
      `))[0];
      const remaining = Math.max(
        0,
        this.#options.budgetMicros - integer(totals?.spentMicros) - integer(totals?.reservedMicros),
      );
      if (micros > remaining) {
        throw new BudgetExceeded(category, micros, remaining, { runId: this.#options.runId });
      }
      await tx.execute(sql`
        INSERT INTO budget_envelopes
          (run_id, category, limit_micros, reserved_micros, spent_micros)
        VALUES (${this.#options.runId}, ${category}, ${this.#options.budgetMicros}, ${micros}, 0)
        ON CONFLICT (run_id, category) DO UPDATE SET
          limit_micros = EXCLUDED.limit_micros,
          reserved_micros = budget_envelopes.reserved_micros + EXCLUDED.reserved_micros
      `);
    });
    this.#reservations.set(ref, { category, micros });
  }

  async #settle(ref: string, actualMicros: number): Promise<void> {
    const reservation = this.#reservations.get(ref);
    if (!reservation) return;
    if (!Number.isSafeInteger(actualMicros) || actualMicros < 0) throw new Error(`Invalid settled cost: ${actualMicros}`);
    const db = await this.#db();
    await asServiceRole(db, async (tx) => {
      const run = rowsOf<{ id: string }>(await tx.execute(sql`
        SELECT id FROM runs WHERE id = ${this.#options.runId} FOR UPDATE
      `))[0];
      if (!run) throw new Error(`Run ${this.#options.runId} was not found while settling budget`);
      const totals = rowsOf<{ reservedMicros: number | string | bigint; spentMicros: number | string | bigint }>(await tx.execute(sql`
        SELECT COALESCE(sum(reserved_micros), 0) AS "reservedMicros",
          COALESCE(sum(spent_micros), 0) AS "spentMicros"
        FROM budget_envelopes WHERE run_id = ${this.#options.runId}
      `))[0];
      const otherReservations = Math.max(0, integer(totals?.reservedMicros) - reservation.micros);
      const available = Math.max(
        0,
        this.#options.budgetMicros - integer(totals?.spentMicros) - otherReservations,
      );
      if (actualMicros > available) {
        throw new BudgetExceeded(reservation.category, actualMicros, available, {
          runId: this.#options.runId,
        });
      }
      await tx.execute(sql`
        UPDATE budget_envelopes SET
          reserved_micros = greatest(0, reserved_micros - ${reservation.micros}),
          spent_micros = spent_micros + ${actualMicros}
        WHERE run_id = ${this.#options.runId} AND category = ${reservation.category}
      `);
      await tx.execute(sql`
        UPDATE runs SET spent_micros = spent_micros + ${actualMicros}
        WHERE id = ${this.#options.runId}
      `);
    });
    this.#reservations.delete(ref);
  }

  async #release(ref: string): Promise<void> {
    const reservation = this.#reservations.get(ref);
    if (!reservation) return;
    const db = await this.#db();
    await asServiceRole(db, async (tx) => {
      await tx.execute(sql`
        UPDATE budget_envelopes SET
          reserved_micros = greatest(0, reserved_micros - ${reservation.micros})
        WHERE run_id = ${this.#options.runId} AND category = ${reservation.category}
      `);
    });
    this.#reservations.delete(ref);
  }

  async #findAuthorisation(id: string): Promise<SpendAuthorisationValue | undefined> {
    const db = await this.#db();
    const row = await asServiceRole(db, async (tx) =>
      rowsOf<AuthorisationRow>(await tx.execute(sql`
        SELECT id, run_id AS "runId", purpose, ceiling_micros AS "ceilingMicros",
          currency, quote_id AS "quoteId", category::text AS category,
          granted_by_user_id AS "grantedByUserId", standing,
          expires_at AS "expiresAt", consumed_by_tool_call_id AS "consumedByToolCallId",
          created_at AS "createdAt"
        FROM spend_authorisations
        WHERE id = ${id} AND run_id = ${this.#options.runId}
        LIMIT 1
      `))[0],
    );
    if (!row) return undefined;
    return SpendAuthorisation.parse({
      ...row,
      ceilingMicros: integer(row.ceilingMicros),
      grantedByUserId: row.grantedByUserId ?? undefined,
      consumedByToolCallId: row.consumedByToolCallId ?? undefined,
      expiresAt: iso(row.expiresAt),
      createdAt: iso(row.createdAt),
    });
  }

  async #consumeAuthorisation(id: string, toolCallId: string): Promise<void> {
    const db = await this.#db();
    const consumed = await asServiceRole(db, async (tx) =>
      rowsOf<{ id: string }>(await tx.execute(sql`
        UPDATE spend_authorisations SET consumed_by_tool_call_id = ${toolCallId}
        WHERE id = ${id} AND run_id = ${this.#options.runId}
          AND consumed_by_tool_call_id IS NULL
        RETURNING id
      `)),
    );
    if (consumed.length !== 1) throw new Error(`Spend authorisation ${id} was already consumed`);
  }
}
