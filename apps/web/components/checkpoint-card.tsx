"use client";

import type { Checkpoint } from "@kiln/contracts";
import { Badge, Button, Field, Textarea } from "@kiln/ui";
import { useMemo, useState } from "react";

export function CheckpointCard({ checkpoint, compact = false, onDecided }: { checkpoint: Checkpoint; compact?: boolean; onDecided?: (status: "approved" | "rejected") => void }) {
  const recommended = useMemo(() => checkpoint.options.find((option) => option.recommended) ?? checkpoint.options[0], [checkpoint.options]);
  const [optionId, setOptionId] = useState(recommended?.id ?? "");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "approved" | "rejected" | "error">(checkpoint.status === "pending" ? "idle" : checkpoint.status === "approved" ? "approved" : "rejected");
  const vetoWindowOpen = checkpoint.prompt.notBefore
    ? new Date(checkpoint.prompt.notBefore).getTime() > Date.now()
    : false;

  const decide = async (status: "approved" | "rejected") => {
    setState("saving");
    try {
      const response = await fetch(`/api/checkpoints/${checkpoint.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, optionId, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      if (!response.ok) throw new Error("decision rejected");
      setState(status);
      onDecided?.(status);
    } catch {
      setState("error");
    }
  };

  return (
    <article className="k-checkpoint-card" data-state={state}>
      <header>
        <div><Badge tone="warning">{checkpoint.kind.replace(/_/g, " ")}</Badge><h3>{checkpoint.title}</h3></div>
        <span className="k-muted">expires {new Date(checkpoint.expiresAt).toLocaleString()}</span>
      </header>
      <p className="k-checkpoint-question">{checkpoint.prompt.question}</p>
      {!compact ? <p className="k-checkpoint-context">{checkpoint.prompt.context}</p> : null}
      <fieldset disabled={state !== "idle" && state !== "error"}>
        <legend>Choose a direction</legend>
        {checkpoint.options.map((option) => (
          <label className="k-checkpoint-option" key={option.id} data-selected={optionId === option.id}>
            <input type="radio" name={`option-${checkpoint.id}`} value={option.id} checked={optionId === option.id} onChange={() => setOptionId(option.id)} />
            <span><strong>{option.label}{option.recommended ? " · recommended" : ""}</strong><small>{option.description}</small><em>{option.consequence}</em></span>
          </label>
        ))}
      </fieldset>
      {!compact ? <Field label="Instruction for the run" htmlFor={`note-${checkpoint.id}`} hint="Optional. This is preserved with the decision."><Textarea id={`note-${checkpoint.id}`} rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></Field> : null}
      <footer>
        <Button variant="primary" disabled={!optionId || vetoWindowOpen || state === "saving" || state === "approved" || state === "rejected"} onClick={() => void decide("approved")}>{state === "saving" ? "Recording…" : vetoWindowOpen ? "Waiting for veto window" : "Approve selection"}</Button>
        <Button variant="ghost" disabled={state === "saving" || state === "approved" || state === "rejected"} onClick={() => void decide("rejected")}>Reject and pause</Button>
        {state === "approved" ? <span className="k-decision-ok">Approved and recorded</span> : state === "rejected" ? <span className="k-decision-stop">Rejected; run remains paused</span> : state === "error" ? <span className="k-decision-stop">Could not record the decision. Try again.</span> : null}
      </footer>
    </article>
  );
}
