import { BudgetExceeded } from "@kiln/contracts";
import { asServiceRole, getDb, rowsOf, type Database } from "@kiln/db";
import type { BudgetGuard, CostSink } from "@kiln/model-gateway";
import { sql } from "drizzle-orm";

interface Reservation {
  readonly micros: number;
}

function micros(value: number | string | bigint | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid model accounting value: ${String(value)}`);
  }
  return parsed;
}

export interface PostgresModelAccountingOptions {
  readonly runId: string;
  readonly budgetMicros: number;
  readonly database?: Database;
}

/** Durable model reservations and ledger writes for one run. */
export class PostgresModelAccounting implements BudgetGuard, CostSink {
  readonly #options: PostgresModelAccountingOptions;
  readonly #reservations = new Map<string, Reservation>();

  constructor(options: PostgresModelAccountingOptions) {
    this.#options = options;
  }

  async #db(): Promise<Database> {
    return this.#options.database ?? getDb();
  }

  async reserve(category: "model", estimatedMicros: number, ref: string): Promise<void> {
    if (!Number.isSafeInteger(estimatedMicros) || estimatedMicros < 0) {
      throw new Error(`Invalid model reservation: ${estimatedMicros}`);
    }
    if (estimatedMicros === 0 || this.#reservations.has(ref)) return;
    const db = await this.#db();
    await asServiceRole(db, async (tx) => {
      await tx.execute(sql`SELECT id FROM runs WHERE id = ${this.#options.runId} FOR UPDATE`);
      const totals = rowsOf<{ spent: number | string | bigint; reserved: number | string | bigint }>(
        await tx.execute(sql`
          SELECT COALESCE(sum(spent_micros), 0) AS spent,
                 COALESCE(sum(reserved_micros), 0) AS reserved
          FROM budget_envelopes WHERE run_id = ${this.#options.runId}
        `),
      )[0];
      const remaining = Math.max(
        0,
        this.#options.budgetMicros - micros(totals?.spent) - micros(totals?.reserved),
      );
      if (estimatedMicros > remaining) {
        throw new BudgetExceeded(category, estimatedMicros, remaining, { runId: this.#options.runId });
      }
      await tx.execute(sql`
        INSERT INTO budget_envelopes
          (run_id, category, limit_micros, reserved_micros, spent_micros)
        VALUES (${this.#options.runId}, 'model', ${this.#options.budgetMicros}, ${estimatedMicros}, 0)
        ON CONFLICT (run_id, category) DO UPDATE SET
          limit_micros = EXCLUDED.limit_micros,
          reserved_micros = budget_envelopes.reserved_micros + EXCLUDED.reserved_micros
      `);
    });
    this.#reservations.set(ref, { micros: estimatedMicros });
  }

  async settle(ref: string, actualMicros: number): Promise<void> {
    const reservation = this.#reservations.get(ref);
    if (!reservation) return;
    if (!Number.isSafeInteger(actualMicros) || actualMicros < 0) {
      throw new Error(`Invalid model settlement: ${actualMicros}`);
    }
    const db = await this.#db();
    await asServiceRole(db, async (tx) => {
      await tx.execute(sql`SELECT id FROM runs WHERE id = ${this.#options.runId} FOR UPDATE`);
      const totals = rowsOf<{ spent: number | string | bigint; reserved: number | string | bigint }>(
        await tx.execute(sql`
          SELECT COALESCE(sum(spent_micros), 0) AS spent,
                 COALESCE(sum(reserved_micros), 0) AS reserved
          FROM budget_envelopes WHERE run_id = ${this.#options.runId}
        `),
      )[0];
      const otherReserved = Math.max(0, micros(totals?.reserved) - reservation.micros);
      const remaining = Math.max(0, this.#options.budgetMicros - micros(totals?.spent) - otherReserved);
      if (actualMicros > remaining) {
        throw new BudgetExceeded("model", actualMicros, remaining, { runId: this.#options.runId });
      }
      await tx.execute(sql`
        UPDATE budget_envelopes SET
          reserved_micros = greatest(0, reserved_micros - ${reservation.micros}),
          spent_micros = spent_micros + ${actualMicros}
        WHERE run_id = ${this.#options.runId} AND category = 'model'
      `);
    });
    this.#reservations.delete(ref);
  }

  async release(ref: string): Promise<void> {
    const reservation = this.#reservations.get(ref);
    if (!reservation) return;
    const db = await this.#db();
    await asServiceRole(db, async (tx) => {
      await tx.execute(sql`
        UPDATE budget_envelopes SET
          reserved_micros = greatest(0, reserved_micros - ${reservation.micros})
        WHERE run_id = ${this.#options.runId} AND category = 'model'
      `);
    });
    this.#reservations.delete(ref);
  }

  async record(entry: Parameters<CostSink["record"]>[0]): Promise<void> {
    const db = await this.#db();
    await asServiceRole(db, async (tx) => {
      await tx.execute(sql`
        INSERT INTO cost_ledger (run_id, category, ref_id, amount_micros, vendor)
        VALUES (${this.#options.runId}, 'model', ${entry.taskId ?? entry.agentId},
          ${entry.costMicros}, ${`${entry.provider}:${entry.model}`})
      `);
    });
  }
}
