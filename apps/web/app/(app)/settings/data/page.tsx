import { Button, Panel, PanelHeader, Stat } from "@kiln/ui";
import { getAccountDataSummary } from "../../../../lib/account-data";
import { AccountDataActions } from "./account-data-actions";

export const dynamic = "force-dynamic";

export default async function Page() {
  const summary = await getAccountDataSummary();
  return (
    <>
      <h1 className="k-page-title">Account data</h1>
      <p className="k-page-lede">
        Export the customer-owned record at any time, or permanently delete this account and its tenant data. Both actions are owner-only and audited.
      </p>

      <Panel style={{ marginTop: "var(--k-space-5)" }}>
        <PanelHeader
          title="Portable export"
          meta="JSON schema v1 · generated from a transactionally consistent tenant view"
          action={<Button asChild size="sm" variant="primary"><a href="/api/account/export">Download export</a></Button>}
        />
        <div className="k-grid k-grid-3">
          <Stat label="Ventures" value={summary.ventures} />
          <Stat label="Runs" value={summary.runs} />
          <Stat label="Artifacts" value={summary.artifacts} />
        </div>
        <div className="k-panel-body" style={{ borderTop: "1px solid var(--k-border)", display: "grid", gap: "var(--k-space-2)" }}>
          <p className="k-panel-meta">
            Includes account and user records, venture briefs, runs and events, artifacts, assets, mirrored orders and metrics, billing ledgers, decisions, and audit history.
          </p>
          <p className="k-panel-meta">
            Vault credentials, credential leases, MCP token hashes, break-glass ciphertext, signed URLs, raw webhook pointers, and infrastructure queue payloads are never exported.
          </p>
        </div>
      </Panel>

      <Panel style={{ marginTop: "var(--k-space-5)", borderColor: "color-mix(in oklch, var(--k-critical) 45%, var(--k-border))" }}>
        <PanelHeader
          title="Delete account"
          meta={`Account ${summary.accountName} · opened ${new Date(summary.createdAt).toLocaleDateString()}`}
        />
        <div className="k-panel-body" style={{ display: "grid", gap: "var(--k-space-4)" }}>
          <p style={{ color: "var(--k-text-muted)", maxWidth: "78ch" }}>
            The deletion transaction removes durable waiters and queued work first, then deletes the account. Database foreign keys cascade through users, ventures, runs, artifacts, mirrored data, billing records, audit history, encrypted credentials, and handover packets.
          </p>
          <AccountDataActions summary={summary} />
        </div>
      </Panel>
    </>
  );
}
