"use client";

import { Button, Empty } from "@kiln/ui";
import { useState } from "react";
import type { AbuseReview } from "../../../../lib/abuse";

export function ReviewQueue({ initial }: { initial: AbuseReview[] }) {
  const [reviews, setReviews] = useState(initial);
  const [busy, setBusy] = useState<string>();
  const pending = reviews.filter((review) => review.status === "pending");

  const decide = async (review: AbuseReview, status: "cleared" | "blocked") => {
    const note = window.prompt(status === "cleared" ? "Why is this safe to clear?" : "Why must publication remain blocked?");
    if (!note?.trim()) return;
    setBusy(review.id);
    try {
      const response = await fetch(`/api/console/abuse/${review.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      if (!response.ok) throw new Error("review decision failed");
      setReviews((current) => current.map((item) => item.id === review.id ? { ...item, status, decision_note: note } : item));
    } finally {
      setBusy(undefined);
    }
  };

  if (pending.length === 0) return <Empty title="No pending reviews" body="Restricted-category findings will appear here before live publication." />;
  return <div className="k-stack">{pending.map((review) => <article className="k-event-card" data-tone="warning" key={review.id}><header><strong>{review.category}</strong><span>{review.venture_name}</span></header><p>{review.reason}</p><pre>{JSON.stringify(review.evidence, null, 2)}</pre><div className="k-inline-actions"><Button size="sm" disabled={busy === review.id} onClick={() => void decide(review, "cleared")}>Clear</Button><Button size="sm" variant="danger" disabled={busy === review.id} onClick={() => void decide(review, "blocked")}>Block</Button></div></article>)}</div>;
}
