"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Field, Panel, PanelHeader, Textarea } from "@kiln/ui";
import type { HandoverSummary } from "../../../lib/handover";

const KEY_COMMANDS = `openssl genpkey -algorithm X25519 -out kiln-break-glass-private.pem
openssl pkey -in kiln-break-glass-private.pem -pubout -out kiln-break-glass-public.pem`;

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  return fallback;
}

export function HandoverClient({ summary }: { summary: HandoverSummary }) {
  const router = useRouter();
  const [publicKey, setPublicKey] = useState("");
  const [keyState, setKeyState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [keyMessage, setKeyMessage] = useState("");
  const [starting, setStarting] = useState<string>();
  const [ventureMessages, setVentureMessages] = useState<Record<string, string>>({});

  async function registerKey(): Promise<void> {
    setKeyState("saving");
    setKeyMessage("");
    const response = await fetch("/api/handover/key", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKeyPem: publicKey }),
    });
    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      setKeyState("error");
      setKeyMessage(messageFrom(body, "The public key could not be registered."));
      return;
    }
    setKeyState("saved");
    setKeyMessage("Public key registered. Keep the private key somewhere KILN cannot access.");
    setPublicKey("");
    router.refresh();
  }

  async function start(ventureId: string): Promise<void> {
    setStarting(ventureId);
    setVentureMessages((current) => ({ ...current, [ventureId]: "" }));
    const response = await fetch("/api/handover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ventureId, idempotencyKey: crypto.randomUUID() }),
    });
    const body = await response.json().catch(() => null) as unknown;
    setStarting(undefined);
    if (!response.ok) {
      setVentureMessages((current) => ({ ...current, [ventureId]: messageFrom(body, "Handover could not be started.") }));
      return;
    }
    setVentureMessages((current) => ({ ...current, [ventureId]: "Packet assembled and encrypted. The five-business-day transfer window has started." }));
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: "var(--k-space-5)", marginTop: "var(--k-space-5)" }}>
      <Panel>
        <PanelHeader
          title="Customer-held recovery key"
          meta={summary.key.registered ? `Registered · ${summary.key.fingerprint?.slice(0, 16)}…` : "Required before an encrypted packet can be created"}
          action={summary.key.registered ? <Badge tone="positive">ready</Badge> : <Badge tone="warning">not registered</Badge>}
        />
        <div className="k-panel-body" style={{ display: "grid", gap: "var(--k-space-4)" }}>
          <p style={{ color: "var(--k-text-muted)", fontSize: "var(--k-text-sm)", maxWidth: "72ch" }}>
            Generate this keypair on your own machine. Paste only the public file below. KILN never asks for, uploads, or stores the private file.
          </p>
          <pre style={{ overflowX: "auto", padding: "var(--k-space-3)", border: "1px solid var(--k-border)", borderRadius: "var(--k-radius)", fontSize: "var(--k-text-xs)" }}>{KEY_COMMANDS}</pre>
          <Field label={summary.key.registered ? "Replace public key" : "X25519 public key"} htmlFor="break-glass-public-key" hint="Contents of kiln-break-glass-public.pem — never the private file.">
            <Textarea id="break-glass-public-key" rows={5} value={publicKey} onChange={(event) => { setPublicKey(event.target.value); setKeyState("idle"); }} placeholder="-----BEGIN PUBLIC KEY-----" spellCheck={false} />
          </Field>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--k-space-3)", flexWrap: "wrap" }}>
            <Button variant="primary" size="sm" disabled={!publicKey.trim() || keyState === "saving"} onClick={() => void registerKey()}>
              {keyState === "saving" ? "Validating…" : summary.key.registered ? "Rotate public key" : "Register public key"}
            </Button>
            {keyMessage ? <span role={keyState === "error" ? "alert" : "status"} className={keyState === "error" ? "k-decision-stop" : "k-decision-ok"}>{keyMessage}</span> : null}
          </div>
          {summary.key.registeredAt ? (
            <div className="k-panel-meta" style={{ display: "grid", gap: 4 }}>
              <p>Algorithm {summary.key.algorithm} · registered {new Date(summary.key.registeredAt).toLocaleString()}</p>
              <code style={{ overflowWrap: "anywhere" }}>SHA-256 {summary.key.fingerprint}</code>
              <p>Rotation applies to new packets only. Keep an old private key until its packets have been replaced.</p>
            </div>
          ) : null}
        </div>
      </Panel>

      {summary.ventures.map((venture) => {
        const unavailable = !summary.key.registered || venture.assets.length === 0 || venture.ownershipMode === "transferred";
        return (
          <Panel key={venture.id}>
            <PanelHeader
              title={venture.name}
              meta={`${venture.assets.length} asset${venture.assets.length === 1 ? "" : "s"} · ${venture.ownershipMode} custody`}
              action={<Badge tone={venture.ownershipMode === "transferred" ? "positive" : "neutral"}>{venture.status}</Badge>}
            />
            {venture.assets.length > 0 ? venture.assets.map((asset) => (
              <div className="k-row" key={asset.id}>
                <div>
                  <strong style={{ fontSize: "var(--k-text-sm)" }}>{asset.displayName}</strong>
                  <div className="k-panel-meta">{asset.kind} · {asset.provider}{asset.externalId ? ` · ${asset.externalId}` : ""}</div>
                </div>
                <div style={{ display: "flex", gap: "var(--k-space-2)" }}><Badge>{asset.ownershipMode}</Badge><Badge tone={asset.status === "active" ? "positive" : "neutral"}>{asset.status}</Badge></div>
              </div>
            )) : <div className="k-panel-body"><p className="k-panel-meta">No provisioned assets are recorded for this venture yet.</p></div>}
            <div className="k-panel-body" style={{ borderTop: "1px solid var(--k-border)", display: "grid", gap: "var(--k-space-3)" }}>
              {venture.latestPacket ? (
                <p className="k-panel-meta">Latest encrypted packet: {venture.latestPacket.status} · {new Date(venture.latestPacket.createdAt).toLocaleString()} · key {venture.latestPacket.keyFingerprint.slice(0, 12)}…</p>
              ) : null}
              <div style={{ display: "flex", gap: "var(--k-space-3)", alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="primary" disabled={unavailable || starting === venture.id} onClick={() => void start(venture.id)}>
                  {starting === venture.id ? "Assembling encrypted packet…" : venture.ownershipMode === "transferred" ? "Already transferred" : "Start handover"}
                </Button>
                <span className="k-panel-meta">Target completion: five business days. Starting does not revoke working access before customer verification.</span>
              </div>
              {ventureMessages[venture.id] ? <p role="status" className={ventureMessages[venture.id]?.includes("could not") ? "k-decision-stop" : "k-decision-ok"}>{ventureMessages[venture.id]}</p> : null}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
