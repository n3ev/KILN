import { Empty, Panel, PanelHeader } from "@kiln/ui";
import { CheckpointCard } from "../../../components/checkpoint-card";
import { listPendingCheckpoints } from "../../../lib/queries";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const checkpoints = await listPendingCheckpoints();
  return (
    <>
      <h1 className="k-page-title">Approvals</h1>
      <p className="k-page-lede">Each decision includes KILN’s recommendation, the alternatives, and what happens next.</p>
      <Panel style={{ marginTop: "var(--k-space-5)" }}>
        <PanelHeader title="Pending decisions" meta={`${checkpoints.length} waiting`} />
        {checkpoints.length === 0 ? <Empty title="Nothing waiting" body="Hard gates, spend authorisations, and reconnect requests appear here." /> : <div className="k-approval-list">{checkpoints.map((checkpoint) => <CheckpointCard key={checkpoint.id} checkpoint={checkpoint} />)}</div>}
      </Panel>
    </>
  );
}
