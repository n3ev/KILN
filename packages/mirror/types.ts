// TODO(prompt-4): live metric ingestion. The interfaces below are complete and
// MirrorReconciler is implemented; this package is inert only because
// Connector.reconcile throws in live mode (packages/connectors/live.ts).
import {
  ConnectorProvider,
  ReconciliationBatch,
  type ConnectorRegistry,
} from "@kiln/connectors";
import { z } from "zod";

export const MirrorConnection = z.object({
  id: z.string().uuid(),
  ventureId: z.string().uuid(),
  provider: ConnectorProvider,
  status: z.enum(["healthy", "degraded", "expired", "revoked"]),
  cursor: z.record(z.string(), z.unknown()).default({}),
  lastSyncAt: z.string().datetime().nullable(),
});
export type MirrorConnection = z.infer<typeof MirrorConnection>;

export const ReconcileOptions = z.object({
  connectionId: z.string().uuid(),
  windowDays: z.number().int().min(1).max(31).default(7),
  windowEnd: z.string().datetime().optional(),
});
export type ReconcileOptions = z.input<typeof ReconcileOptions>;

export const MirrorWriteResult = z.object({
  connectionId: z.string().uuid(),
  provider: ConnectorProvider,
  snapshots: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
  cursor: z.record(z.string(), z.unknown()),
  reconciledThrough: z.string().datetime(),
});
export type MirrorWriteResult = z.infer<typeof MirrorWriteResult>;

export interface MirrorStore {
  loadConnection(connectionId: string): Promise<MirrorConnection | undefined>;
  persistBatch(connection: MirrorConnection, batch: ReconciliationBatch): Promise<MirrorWriteResult>;
  markFailure(connectionId: string, error: unknown, at: string): Promise<void>;
}

export interface MirrorReconcilerOptions {
  readonly connectors: ConnectorRegistry;
  readonly store: MirrorStore;
  readonly sandbox: boolean;
  readonly now?: () => string;
}

/** Coordinates polling and persistence without knowing any provider payload. */
export class MirrorReconciler {
  readonly #connectors: ConnectorRegistry;
  readonly #store: MirrorStore;
  readonly #sandbox: boolean;
  readonly #now: () => string;

  constructor(options: MirrorReconcilerOptions) {
    this.#connectors = options.connectors;
    this.#store = options.store;
    this.#sandbox = options.sandbox;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async reconcile(input: ReconcileOptions): Promise<MirrorWriteResult> {
    const options = ReconcileOptions.parse(input);
    const connection = await this.#store.loadConnection(options.connectionId);
    if (!connection) throw new Error(`Mirror connection ${options.connectionId} was not found`);
    if (connection.status === "expired" || connection.status === "revoked") {
      throw new Error(`Mirror connection ${connection.id} is ${connection.status}`);
    }

    const windowEnd = options.windowEnd ?? this.#now();
    const windowStart = new Date(
      new Date(windowEnd).getTime() - options.windowDays * 24 * 60 * 60 * 1_000,
    ).toISOString();

    try {
      const connector = this.#connectors.resolve(connection.provider, this.#sandbox);
      const batch = await connector.reconcile({
        ventureId: connection.ventureId,
        connectionId: connection.id,
        provider: connection.provider,
        windowStart,
        windowEnd,
        cursor: connection.cursor,
      });
      return this.#store.persistBatch(connection, batch);
    } catch (error) {
      await this.#store.markFailure(connection.id, error, this.#now());
      throw error;
    }
  }
}
