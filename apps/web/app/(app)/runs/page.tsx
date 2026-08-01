import Link from "next/link";
import { Badge, Panel, PanelHeader, Empty, formatMicros } from "@kiln/ui";
import { listRuns } from "../../../lib/queries";

const tone = (status: string) =>
  status === "succeeded" ? "positive" : status === "failed" ? "critical" :
  status === "waiting_on_checkpoint" ? "warning" : "accent";

export default async function RunsPage() {
  const runs = await listRuns();

  return (
    <>
      <h1 className="k-page-title">Runs</h1>
      <p className="k-page-lede">Every build KILN has executed, with what it cost.</p>

      <Panel style={{ marginTop: "var(--k-space-5)" }}>
        <PanelHeader title="All runs" meta={`${runs.length} total`} />
        {runs.length === 0 ? (
          <Empty title="No runs yet" body="Start one from the intake wizard and it will appear here." />
        ) : (
          runs.map((run) => (
            <div key={run.id} className="k-row">
              <div style={{ minWidth: 0 }}>
                <Link href={`/runs/${run.id}`} className="k-link" style={{ fontWeight: 540 }}>
                  {run.ventureName}
                </Link>
                <div style={{ color: "var(--k-text-muted)", fontSize: "var(--k-text-xs)" }}>
                  {run.playbookId} · {run.autonomy}
                  {run.currentPhase ? ` · ${run.currentPhase}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: "var(--k-space-4)", alignItems: "center" }}>
                <span className="k-num" style={{ fontSize: "var(--k-text-xs)", color: "var(--k-text-muted)" }}>
                  {formatMicros(run.spentMicros)} / {formatMicros(run.budgetMicros)}
                </span>
                <Badge tone={tone(run.status)}>{run.status.replace(/_/g, " ")}</Badge>
              </div>
            </div>
          ))
        )}
      </Panel>
    </>
  );
}
