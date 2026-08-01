import { createHash } from "node:crypto";
import {
  ConnectorProvider,
  type ReconciliationBatch,
} from "@kiln/connectors";
import { asServiceRole, getDb, rowsOf, type Database } from "@kiln/db";
import { sql } from "drizzle-orm";
import {
  MirrorConnection,
  MirrorWriteResult,
  type MirrorStore,
} from "./types.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function dimensionsHash(dimensions: Readonly<Record<string, string>>): string {
  return createHash("sha256").update(stableJson(dimensions)).digest("hex");
}

function errorJson(error: unknown): string {
  return JSON.stringify({
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  });
}

interface ConnectionRow {
  id: string;
  ventureId: string;
  provider: string;
  status: "healthy" | "degraded" | "expired" | "revoked";
  cursor: unknown;
  lastSyncAt: string | Date | null;
}

export interface PostgresMirrorStoreOptions {
  readonly database?: Database;
}

/** Idempotent canonical persistence for webhook-repair polling batches. */
export class PostgresMirrorStore implements MirrorStore {
  readonly #database?: Database;

  constructor(options: PostgresMirrorStoreOptions = {}) {
    this.#database = options.database;
  }

  async #db(): Promise<Database> {
    return this.#database ?? getDb();
  }

  async loadConnection(connectionId: string): Promise<MirrorConnection | undefined> {
    const db = await this.#db();
    const row = await asServiceRole(db, async (tx) =>
      rowsOf<ConnectionRow>(
        await tx.execute(sql`
          SELECT id,
                 venture_id AS "ventureId",
                 provider,
                 status::text AS status,
                 sync_cursor AS cursor,
                 last_sync_at AS "lastSyncAt"
          FROM connections
          WHERE id = ${connectionId}
          LIMIT 1
        `),
      )[0],
    );
    if (!row) return undefined;
    return MirrorConnection.parse({
      ...row,
      provider: ConnectorProvider.parse(row.provider),
      cursor: row.cursor ?? {},
      lastSyncAt:
        row.lastSyncAt instanceof Date
          ? row.lastSyncAt.toISOString()
          : row.lastSyncAt,
    });
  }

  async persistBatch(
    connection: MirrorConnection,
    batch: ReconciliationBatch,
  ): Promise<MirrorWriteResult> {
    if (batch.provider !== connection.provider) {
      throw new Error(`Batch provider ${batch.provider} does not match connection ${connection.provider}`);
    }
    if (batch.snapshots.some((snapshot) => snapshot.ventureId !== connection.ventureId)) {
      throw new Error("Mirror batch contains a metric for a different venture");
    }
    if (batch.orders.some((order) => order.ventureId !== connection.ventureId)) {
      throw new Error("Mirror batch contains an order for a different venture");
    }

    const db = await this.#db();
    await asServiceRole(db, async (tx) => {
      for (const snapshot of batch.snapshots) {
        const dimensions = JSON.stringify(snapshot.dimensions);
        await tx.execute(sql`
          INSERT INTO metric_snapshots
            (venture_id, provider, metric_key, ts, value, dimensions, dimensions_hash, currency)
          VALUES
            (${snapshot.ventureId}, ${snapshot.provider}, ${snapshot.metricKey}, ${snapshot.ts},
             ${snapshot.value}, ${dimensions}::jsonb, ${dimensionsHash(snapshot.dimensions)},
             ${snapshot.currency ?? null})
          ON CONFLICT (venture_id, provider, metric_key, ts, dimensions_hash)
          DO UPDATE SET value = EXCLUDED.value,
                        currency = EXCLUDED.currency,
                        dimensions = EXCLUDED.dimensions
        `);
      }

      for (const order of batch.orders) {
        await tx.execute(sql`
          INSERT INTO orders_mirror
            (venture_id, provider, external_id, placed_at, gross_cents, net_cents,
             currency, items, customer_ref, status)
          VALUES
            (${order.ventureId}, ${order.provider}, ${order.externalId}, ${order.placedAt},
             ${order.grossCents}, ${order.netCents}, ${order.currency},
             ${JSON.stringify(order.items)}::jsonb, ${order.customerRef ?? null}, ${order.status})
          ON CONFLICT (venture_id, provider, external_id)
          DO UPDATE SET placed_at = EXCLUDED.placed_at,
                        gross_cents = EXCLUDED.gross_cents,
                        net_cents = EXCLUDED.net_cents,
                        currency = EXCLUDED.currency,
                        items = EXCLUDED.items,
                        customer_ref = EXCLUDED.customer_ref,
                        status = EXCLUDED.status
        `);
      }

      await tx.execute(sql`
        UPDATE connections
        SET status = 'healthy',
            last_sync_at = ${batch.windowEnd},
            sync_cursor = ${JSON.stringify(batch.nextCursor)}::jsonb,
            health = ${JSON.stringify({
              lastReconciliationMode: batch.mode,
              lastWindowStart: batch.windowStart,
              lastWindowEnd: batch.windowEnd,
            })}::jsonb
        WHERE id = ${connection.id} AND venture_id = ${connection.ventureId}
      `);
    });

    return MirrorWriteResult.parse({
      connectionId: connection.id,
      provider: connection.provider,
      snapshots: batch.snapshots.length,
      orders: batch.orders.length,
      cursor: batch.nextCursor,
      reconciledThrough: batch.windowEnd,
    });
  }

  async markFailure(connectionId: string, error: unknown, at: string): Promise<void> {
    const db = await this.#db();
    await asServiceRole(db, async (tx) => {
      await tx.execute(sql`
        UPDATE connections
        SET status = CASE WHEN status IN ('expired', 'revoked') THEN status ELSE 'degraded' END,
            health = ${JSON.stringify({ reconciliationFailedAt: at })}::jsonb
                     || jsonb_build_object('lastError', ${errorJson(error)}::jsonb)
        WHERE id = ${connectionId}
      `);
    });
  }
}
