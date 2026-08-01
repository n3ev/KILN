import Link from "next/link";
import { Badge, Empty, Panel, PanelHeader } from "@kiln/ui";
import { listVentures } from "../../../lib/queries";

export default async function VenturesPage() {
  const ventures = await listVentures();
  return (
    <>
      <h1 className="k-page-title">Ventures</h1>
      <p className="k-page-lede">Every business KILN has built or is building for this account.</p>
      <Panel style={{ marginTop: "var(--k-space-5)" }}>
        <PanelHeader title="All ventures" meta={`${ventures.length} total`} />
        {ventures.length === 0 ? (
          <Empty title="Nothing here yet" body="Run `pnpm seed` for demo ventures, or start one from intake." />
        ) : (
          ventures.map((v) => (
            <div key={v.id} className="k-row">
              <div>
                <Link href={`/ventures/${v.id}`} className="k-link" style={{ fontWeight: 540 }}>{v.name}</Link>
                <div style={{ color: "var(--k-text-muted)", fontSize: "var(--k-text-xs)" }}>
                  {v.archetype} · {v.ownership_mode}{v.primary_domain ? ` · ${v.primary_domain}` : ""}
                </div>
              </div>
              <Badge tone={v.status === "live" ? "positive" : "neutral"}>{v.status}</Badge>
            </div>
          ))
        )}
      </Panel>
    </>
  );
}
