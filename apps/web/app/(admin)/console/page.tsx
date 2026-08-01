import { Empty, Panel, PanelHeader } from "@kiln/ui";
import { McpTokenPanel } from "./mcp-token-panel";

export default function Page() {
  return (
    <>
      <h1 className="k-page-title">Operator console</h1>
      <p className="k-page-lede">Margins, runs, incidents, and the tool catalogue.</p>
      <Panel style={{ marginTop: "var(--k-space-5)" }}>
        <PanelHeader title="Console" />
        <Empty title="Console" body="Per-run margin and incident views land in prompt 2. The cost ledger is already recording every model and tool call." />
      </Panel>
      <McpTokenPanel />
    </>
  );
}
