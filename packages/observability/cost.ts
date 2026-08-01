import type { BudgetCategory } from "@kiln/contracts";
import { BudgetExceeded } from "@kiln/contracts";
import { logger } from "./logger.js";

/**
 * Cost attribution and budget envelopes.
 *
 * CLAUDE.md §2.5: money is accounted for at the point of spend — reserved
 * *before* the spend, settled after. The reserve/settle split matters because
 * the estimate and the actual almost never match: a model call is priced from a
 * token estimate, a domain from a quoted price. Reserving the estimate stops
 * concurrent calls from collectively overrunning; settling corrects the ledger.
 *
 * This module holds the arithmetic and the invariants. Persistence lives in
 * packages/runtime, which writes to `budget_envelopes` and `cost_ledger` — kept
 * apart so the rules stay unit-testable without a database.
 */

export interface Envelope {
  category: BudgetCategory;
  limitMicros: number;
  reservedMicros: number;
  spentMicros: number;
}

export interface Reservation {
  readonly id: string;
  readonly category: BudgetCategory;
  readonly amountMicros: number;
}

export function availableMicros(e: Envelope): number {
  return e.limitMicros - e.reservedMicros - e.spentMicros;
}

/**
 * Reserves against an envelope, or throws *before* the caller spends anything.
 * Returns a new envelope rather than mutating, so a failed reservation cannot
 * leave a half-applied balance.
 */
export function reserve(e: Envelope, amountMicros: number, ref: string): { envelope: Envelope; reservation: Reservation } {
  if (amountMicros < 0) {
    throw new BudgetExceeded(e.category, amountMicros, availableMicros(e), { reason: "negative reservation" });
  }
  const available = availableMicros(e);
  if (amountMicros > available) {
    throw new BudgetExceeded(e.category, amountMicros, available, { ref });
  }
  return {
    envelope: { ...e, reservedMicros: e.reservedMicros + amountMicros },
    reservation: { id: ref, category: e.category, amountMicros },
  };
}

/**
 * Settles a reservation with the actual cost.
 *
 * An actual above the reservation is allowed — the alternative is discarding a
 * charge that has already been incurred, which would make the ledger a
 * comforting fiction. It is logged loudly instead, because a persistent
 * under-estimate is a costing bug worth chasing.
 */
export function settle(e: Envelope, reservation: Reservation, actualMicros: number): Envelope {
  const released = Math.min(reservation.amountMicros, e.reservedMicros);

  if (actualMicros > reservation.amountMicros) {
    logger.warn("actual cost exceeded reservation", {
      category: e.category,
      ref: reservation.id,
      reservedMicros: reservation.amountMicros,
      actualMicros,
    });
  }

  return {
    ...e,
    reservedMicros: e.reservedMicros - released,
    spentMicros: e.spentMicros + Math.max(0, actualMicros),
  };
}

/** Releases a reservation whose work never happened (a failed call). */
export function release(e: Envelope, reservation: Reservation): Envelope {
  return { ...e, reservedMicros: Math.max(0, e.reservedMicros - reservation.amountMicros) };
}

/** Token pricing → micros. Providers quote per 1k tokens; we store micros. */
export function modelCostMicros(
  promptTokens: number,
  completionTokens: number,
  pricing: { promptMicrosPerKTok: number; completionMicrosPerKTok: number },
): number {
  return Math.ceil(
    (promptTokens / 1000) * pricing.promptMicrosPerKTok +
      (completionTokens / 1000) * pricing.completionMicrosPerKTok,
  );
}

export const microsToDisplay = (micros: number, currency = "USD"): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(micros / 1_000_000);
