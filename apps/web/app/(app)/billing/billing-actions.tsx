"use client";

import { Button, Select } from "@kiln/ui";
import { useState } from "react";

export function BillingActions({ planId, current }: { planId: string; current: boolean }) {
  const [interval, setInterval] = useState<"week" | "month" | "year">("week");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function checkout(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId, interval }),
      });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? "Checkout could not be created");
      window.location.assign(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout could not be created");
      setBusy(false);
    }
  }

  if (current) return <Button disabled>Current plan</Button>;
  return (
    <div style={{ display: "grid", gap: "var(--k-space-2)" }}>
      <Select value={interval} onChange={(event) => setInterval(event.target.value as typeof interval)} aria-label="Billing interval">
        <option value="week">Weekly</option>
        <option value="month">Monthly · 10% off</option>
        <option value="year">Annual · 20% off</option>
      </Select>
      <Button variant="primary" disabled={busy} onClick={() => void checkout()}>
        {busy ? "Opening checkout…" : "Choose plan"}
      </Button>
      {error ? <span className="k-decision-stop">{error}</span> : null}
    </div>
  );
}

export function PortalButton() {
  const [busy, setBusy] = useState(false);
  async function open(): Promise<void> {
    setBusy(true);
    const response = await fetch("/api/billing/portal", { method: "POST" });
    const result = await response.json() as { url?: string; error?: string };
    if (response.ok && result.url) window.location.assign(result.url);
    else setBusy(false);
  }
  return <Button size="sm" disabled={busy} onClick={() => void open()}>{busy ? "Opening…" : "Manage billing"}</Button>;
}

