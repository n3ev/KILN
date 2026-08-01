import { Empty, Panel, PanelHeader } from "@kiln/ui";

export default function Page() {
  return (
    <>
      <h1 className="k-page-title">Artifacts</h1>
      <p className="k-page-lede">Every durable output, versioned and content-addressed.</p>
      <Panel style={{ marginTop: "var(--k-space-5)" }}>
        <PanelHeader title="Browse by venture" />
        <Empty title="Browse by venture" body="Open a run to see the artifacts it produced. A cross-venture browser lands in prompt 2." />
      </Panel>
    </>
  );
}
