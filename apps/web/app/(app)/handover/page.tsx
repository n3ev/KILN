import { Empty } from "@kiln/ui";
import { getHandoverSummary } from "../../../lib/handover";
import { HandoverClient } from "./handover-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  const summary = await getHandoverSummary();
  return (
    <>
      <h1 className="k-page-title">Handover</h1>
      <p className="k-page-lede">Take every account KILN holds for you. Always available, never gated behind a conversation. Target: five working days.</p>
      {summary.ventures.length === 0
        ? <Empty title="Nothing to hand over yet" body="Once a venture provisions real assets, each one appears here with its transfer mechanism and a verification step." />
        : <HandoverClient summary={summary} />}
    </>
  );
}
