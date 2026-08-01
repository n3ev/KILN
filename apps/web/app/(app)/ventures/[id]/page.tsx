import { notFound } from "next/navigation";
import { Badge, Panel, PanelHeader, Stat, Empty, formatCount, formatMicros } from "@kiln/ui";
import { getVenture, ventureMetrics } from "../../../../lib/queries";

/** The venture dashboard — the one screen that says how the business is doing. */
export default async function VenturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const venture = await getVenture(id);
  if (!venture) notFound();

  const points = await ventureMetrics(id, 30);
  const byKey = (key: string) => points.filter((p) => p.metric_key === key);

  const sum = (key: string, days: number) => {
    const rows = byKey(key);
    return rows.slice(Math.max(0, rows.length - days)).reduce((n, r) => n + Number(r.value), 0);
  };

  const revenue30 = sum("revenue_gross", 30);
  const orders30 = sum("orders", 30);
  const sessions30 = sum("sessions", 30);
  const yesterdayRevenue = Number(byKey("revenue_gross").at(-1)?.value ?? 0);
  const yesterdayOrders = Number(byKey("orders").at(-1)?.value ?? 0);
  const lastSync = points.at(-1)?.ts;
  const revenueCurrency = byKey("revenue_gross").find((point) => point.currency)?.currency;
  const displayRevenue = (micros: number) => revenueCurrency ? formatMicros(micros, revenueCurrency) : "Currency unavailable";

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="k-page-title">{venture.name}</h1>
          <p className="k-page-lede">
            {venture.archetype} · {venture.ownership_mode}
            {venture.primary_domain ? ` · ${venture.primary_domain}` : ""}
          </p>
        </div>
        <Badge tone={venture.status === "live" ? "positive" : "neutral"}>{venture.status}</Badge>
      </div>

      <Panel style={{ marginTop: "var(--k-space-5)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <Stat label="Revenue yesterday" value={displayRevenue(yesterdayRevenue)} asOf={lastSync ? new Date(lastSync).toISOString().slice(0, 10) : undefined} />
          <Stat label="Orders yesterday" value={formatCount(yesterdayOrders)} />
          <Stat label="Revenue, 30 days" value={displayRevenue(revenue30)} />
          <Stat label="Orders, 30 days" value={formatCount(orders30)} />
          <Stat label="Sessions, 30 days" value={formatCount(sessions30)} />
        </div>
      </Panel>

      <Panel style={{ marginTop: "var(--k-space-5)" }}>
        <PanelHeader
          title="Operator digest"
          meta="Three sentences, always with the numbers that produced them."
        />
        <Empty
          title="No digest yet"
          body="The Operator agent writes one each morning once the venture has a full day of data. It is wired to the daily loop in prompt 5."
        />
      </Panel>

      <Panel style={{ marginTop: "var(--k-space-5)" }}>
        <PanelHeader title="Data health" meta={`${points.length} points mirrored over 30 days`} />
        <div className="k-row">
          <span>Last sync</span>
          <span className="k-num">{lastSync ? new Date(lastSync).toISOString().replace("T", " ").slice(0, 16) : "never"}</span>
        </div>
      </Panel>
    </>
  );
}
