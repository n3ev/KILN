"use client";

import { Button, Field, Input } from "@kiln/ui";
import { useState } from "react";
import type { AccountDataSummary, AccountDeletionReceipt } from "../../../../lib/account-data";

export function AccountDataActions({ summary }: { summary: AccountDataSummary }) {
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<AccountDeletionReceipt>();

  async function removeAccount(): Promise<void> {
    setDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const result = await response.json() as AccountDeletionReceipt | { error?: string };
      if (!response.ok || !("deleted" in result)) {
        throw new Error("error" in result ? result.error ?? "Account deletion could not be completed." : "Account deletion could not be completed.");
      }
      setReceipt(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account deletion could not be completed.");
      setDeleting(false);
    }
  }

  if (receipt) {
    return (
      <div role="status" style={{ display: "grid", gap: "var(--k-space-3)" }}>
        <p className="k-decision-ok"><strong>Account data deleted.</strong></p>
        <p className="k-panel-meta">
          Receipt {receipt.receiptId} · {new Date(receipt.deletedAt).toLocaleString()}
        </p>
        <p className="k-panel-meta">
          Removed {receipt.removed.ventures} ventures, {receipt.removed.runs} runs, {receipt.removed.artifacts} artifacts,
          {` ${receipt.removed.eventWaiters}`} durable waiters, and {receipt.removed.queuedJobs} queued jobs.
        </p>
        <p className="k-panel-meta">
          This session no longer has an account. In the local demo, run <code>pnpm seed</code> to recreate the demo identity.
        </p>
      </div>
    );
  }

  const exactMatch = confirmation === summary.accountName;
  return (
    <div style={{ display: "grid", gap: "var(--k-space-4)" }}>
      {summary.liveStripeSubscription ? (
        <div className="k-banner k-banner-warning" role="alert">
          Cancel the live Stripe subscription from Billing first. KILN will not remove local billing state while an external subscription can still renew.
        </div>
      ) : null}
      <Field
        label={<>Type <strong>{summary.accountName}</strong> to confirm</>}
        htmlFor="account-delete-confirmation"
        hint="Matching is exact and case-sensitive. This cannot be undone."
      >
        <Input
          id="account-delete-confirmation"
          value={confirmation}
          onChange={(event) => { setConfirmation(event.target.value); setError(""); }}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <div style={{ display: "flex", gap: "var(--k-space-3)", alignItems: "center", flexWrap: "wrap" }}>
        <Button
          variant="danger"
          disabled={!exactMatch || deleting || summary.liveStripeSubscription}
          onClick={() => void removeAccount()}
        >
          {deleting ? "Deleting account data…" : "Permanently delete account"}
        </Button>
        {error ? <span role="alert" className="k-decision-stop">{error}</span> : null}
      </div>
    </div>
  );
}
