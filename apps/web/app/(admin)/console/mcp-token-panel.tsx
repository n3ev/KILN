"use client";

import { Badge, Button, Field, Input, Panel, PanelHeader } from "@kiln/ui";
import { useCallback, useEffect, useState } from "react";

interface TokenRow {
  id: string;
  label: string;
  scopes: string[];
  revoked_at: number | string | null;
  expires_at: number | string | null;
}

const DEFAULT_SCOPES = ["research:read", "commerce:read", "analytics:read"];

export function McpTokenPanel() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [label, setLabel] = useState("Local inspector");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/mcp/tokens", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json() as { tokens: TokenRow[] };
    setTokens(result.tokens);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function issue(): Promise<void> {
    setBusy(true);
    setError("");
    const response = await fetch("/api/mcp/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, scopes: DEFAULT_SCOPES, ttlHours: 720, rateLimitPerMinute: 60 }),
    });
    const result = await response.json() as { token?: string; error?: string };
    if (!response.ok || !result.token) setError(result.error ?? "Token could not be issued");
    else {
      setSecret(result.token);
      await refresh();
    }
    setBusy(false);
  }

  async function revoke(tokenId: string): Promise<void> {
    await fetch("/api/mcp/tokens", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokenId }),
    });
    await refresh();
  }

  return (
    <Panel style={{ marginTop: "var(--k-space-5)" }}>
      <PanelHeader title="Sandbox MCP access" meta="Read-only tools only. The plaintext token is shown once and stored as SHA-256." />
      <div className="k-panel-body" style={{ display: "grid", gap: "var(--k-space-4)" }}>
        <Field label="Token label" htmlFor="mcp-label" hint={`Scopes: ${DEFAULT_SCOPES.join(", ")}`}>
          <Input id="mcp-label" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <div><Button variant="primary" disabled={busy || label.trim().length < 2} onClick={() => void issue()}>{busy ? "Issuing…" : "Issue 30-day token"}</Button></div>
        {secret ? (
          <div className="k-banner k-banner-warning">
            <strong>Copy this now; it cannot be shown again.</strong>
            <code style={{ display: "block", marginTop: 8, overflowWrap: "anywhere" }}>{secret}</code>
          </div>
        ) : null}
        {error ? <span className="k-decision-stop">{error}</span> : null}
      </div>
      {tokens.map((token) => (
        <div className="k-row" key={token.id}>
          <div><strong>{token.label}</strong><div className="k-panel-meta">{token.scopes.join(", ")}</div></div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--k-space-2)" }}>
            <Badge tone={token.revoked_at ? "critical" : "positive"}>{token.revoked_at ? "revoked" : "active"}</Badge>
            {!token.revoked_at ? <Button size="sm" variant="ghost" onClick={() => void revoke(token.id)}>Revoke</Button> : null}
          </div>
        </div>
      ))}
    </Panel>
  );
}

