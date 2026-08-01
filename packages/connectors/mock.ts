import { createHash } from "node:crypto";
import {
  MetricSnapshot as MetricSnapshotSchema,
  type MetricKey,
  type MetricProvider,
  type MetricSnapshot,
} from "@kiln/contracts";
import {
  type Connector,
  type ConnectorProvider,
  EscrowScheduleReceipt,
  EscrowScheduleRequest,
  type EscrowScheduler,
  type MirroredOrder,
  ReconciliationBatch,
  ReconciliationRequest,
  RotationRequest,
  type RotationPolicy,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

const ROTATION: Readonly<Record<ConnectorProvider, RotationPolicy>> = {
  shopify: "supported",
  stripe: "reissue-only",
  analytics: "reissue-only",
  resend: "supported",
  "cal-com": "manual",
  ads: "manual",
};

function digest(material: string): string {
  return createHash("sha256").update(material).digest("hex");
}

function sample(material: string, minimum: number, span: number): number {
  const value = Number.parseInt(digest(material).slice(0, 8), 16);
  return minimum + (value % span);
}

function utcDays(start: string, end: string): string[] {
  const first = Math.floor(new Date(start).getTime() / DAY_MS) * DAY_MS;
  const last = new Date(end).getTime();
  const days: string[] = [];
  for (let cursor = first; cursor < last; cursor += DAY_MS) {
    days.push(new Date(cursor).toISOString());
  }
  return days;
}

function metric(
  request: ReconciliationRequest,
  ts: string,
  metricKey: MetricKey,
  value: number,
  currency?: string,
): MetricSnapshot {
  return MetricSnapshotSchema.parse({
    ventureId: request.ventureId,
    provider: request.provider as MetricProvider,
    metricKey,
    ts,
    value,
    dimensions: {},
    ...(currency ? { currency } : {}),
  });
}

function commerceDay(
  request: ReconciliationRequest,
  ts: string,
): { snapshots: MetricSnapshot[]; orders: MirroredOrder[] } {
  const key = `${request.provider}:${request.ventureId}:${ts}`;
  const count = sample(`${key}:orders`, 1, 7);
  const averageCents = sample(`${key}:aov`, 2_400, 8_000);
  const grossCents = count * averageCents;
  const netCents = Math.round(grossCents * 0.94);
  const orders: MirroredOrder[] = Array.from({ length: count }, (_, index) => {
    const orderGross = averageCents + sample(`${key}:order:${index}`, 0, 900);
    const customerRef = digest(`${request.ventureId}:customer:${index % 4}`).slice(0, 20);
    return {
      ventureId: request.ventureId,
      provider: request.provider,
      externalId: `mock_${digest(`${key}:${index}`).slice(0, 20)}`,
      placedAt: new Date(new Date(ts).getTime() + (index + 1) * 60 * 60 * 1_000).toISOString(),
      grossCents: orderGross,
      netCents: Math.round(orderGross * 0.94),
      currency: "AUD",
      items: [{ sku: `SKU-${sample(`${key}:sku:${index}`, 100, 900)}`, quantity: 1, grossCents: orderGross }],
      customerRef,
      status: "paid",
    };
  });
  return {
    snapshots: [
      metric(request, ts, "orders", count),
      metric(request, ts, "units", count, undefined),
      metric(request, ts, "revenue_gross", grossCents * 10_000, "AUD"),
      metric(request, ts, "revenue_net", netCents * 10_000, "AUD"),
      metric(request, ts, "aov", averageCents * 10_000, "AUD"),
    ],
    orders,
  };
}

function analyticsDay(request: ReconciliationRequest, ts: string): MetricSnapshot[] {
  const key = `${request.provider}:${request.ventureId}:${ts}`;
  const sessions = sample(`${key}:sessions`, 80, 540);
  const orders = sample(`${key}:orders`, 1, 12);
  return [
    metric(request, ts, "sessions", sessions),
    metric(request, ts, "conversion_rate", Number((orders / sessions).toFixed(6))),
  ];
}

/** Deterministic, schema-valid and network-free connector used by default. */
export class MockConnector implements Connector {
  readonly mode = "mock" as const;
  readonly rotation: RotationPolicy;

  constructor(readonly provider: ConnectorProvider) {
    this.rotation = ROTATION[provider];
  }

  async reconcile(input: ReconciliationRequest): Promise<ReconciliationBatch> {
    const request = ReconciliationRequest.parse(input);
    if (request.provider !== this.provider) {
      throw new Error(`Connector ${this.provider} cannot reconcile ${request.provider}`);
    }

    const snapshots: MetricSnapshot[] = [];
    const orders: MirroredOrder[] = [];
    for (const ts of utcDays(request.windowStart, request.windowEnd)) {
      if (this.provider === "shopify" || this.provider === "stripe") {
        const day = commerceDay(request, ts);
        snapshots.push(...day.snapshots);
        orders.push(...day.orders);
      } else {
        snapshots.push(...analyticsDay(request, ts));
      }
    }

    return ReconciliationBatch.parse({
      provider: this.provider,
      mode: this.mode,
      snapshots,
      orders,
      nextCursor: { through: request.windowEnd, fixture: digest(JSON.stringify(request)).slice(0, 16) },
      windowStart: request.windowStart,
      windowEnd: request.windowEnd,
    });
  }

  async issueRotationCredential(input: RotationRequest): Promise<string> {
    const request = RotationRequest.parse(input);
    if (request.provider !== this.provider) throw new Error(`Rotation provider mismatch for ${this.provider}`);
    if (this.rotation === "manual") throw new Error(`${this.provider} requires manual credential rotation`);
    return `kiln_mock_${digest(`${request.provider}:${request.accountId}:${request.credentialId}:rotation`).slice(0, 40)}`;
  }

  async verifyRotationCredential(secret: string, input: RotationRequest): Promise<boolean> {
    return secret === (await this.issueRotationCredential(input));
  }
}

/** Prompt-1 escrow seam: deterministic scheduling, without storage or email side effects. */
export class MockEscrowScheduler implements EscrowScheduler {
  readonly mode = "mock" as const;

  async schedule(input: EscrowScheduleRequest): Promise<EscrowScheduleReceipt> {
    const request = EscrowScheduleRequest.parse(input);
    return EscrowScheduleReceipt.parse({
      scheduleKey: digest(
        `${request.ventureId}:${request.accountId}:${request.recipientPublicKey}:${request.scheduledFor}`,
      ),
      mode: this.mode,
      ventureId: request.ventureId,
      scheduledFor: request.scheduledFor,
      status: "scheduled",
    });
  }
}
