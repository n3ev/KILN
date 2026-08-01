"use client";

import { SLOT_QUESTIONS, SlotKey, type SlotKey as SlotKeyValue } from "@kiln/contracts";
import { Badge, Button, CostMeter, Field, Panel, PanelHeader, Textarea } from "@kiln/ui";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";

type SlotDraft = { status: "unanswered" | "answered" | "deferred"; value: string; reason: string; inferred?: boolean };

const makeSlots = (): Record<SlotKeyValue, SlotDraft> => Object.fromEntries(
  SlotKey.options.map((key) => [key, { status: "unanswered", value: "", reason: "" }]),
) as Record<SlotKeyValue, SlotDraft>;

const plans = {
  physical: { label: "Physical commerce", duration: "80–110 minutes", cost: "£6–£12 build credits", build: ["Demand validation and landed-cost model", "Brand system and product catalogue", "Staged Shopify storefront", "Compliance, test checkout, and launch pack"] },
  digital: { label: "Digital product", duration: "55–80 minutes", cost: "£4–£8 build credits", build: ["Demand validation and offer architecture", "Brand and deliverable specification", "Checkout plus signed delivery surface", "Nurture sequence and launch pack"] },
  service: { label: "Local service", duration: "60–90 minutes", cost: "£4–£9 build credits", build: ["Local demand and competitor analysis", "Service menu, price ladder, and brand", "Booking and quote-request flow", "Area pages, compliance, and launch pack"] },
} as const;

function inferArchetype(text: string): keyof typeof plans {
  const value = text.toLowerCase();
  if (/service|repair|consult|mobile|appointment|booking/.test(value)) return "service";
  if (/template|course|download|notion|ebook|software|digital/.test(value)) return "digital";
  return "physical";
}

export function IntakeWizard() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [slots, setSlots] = useState(makeSlots);
  const [step, setStep] = useState(0);
  const [disclosure, setDisclosure] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [submitError, setSubmitError] = useState("");
  const idempotencyKey = useRef<string | null>(null);
  const slotIndex = step - 1;
  const activeKey = slotIndex >= 0 && slotIndex < SlotKey.options.length ? SlotKey.options[slotIndex] : undefined;
  const resolved = SlotKey.options.filter((key) => slots[key].status !== "unanswered").length;
  const archetype = inferArchetype(`${idea} ${slots.offer.value}`);
  const plan = plans[archetype];
  const planStep = SlotKey.options.length + 1;

  const canContinue = useMemo(() => {
    if (step === 0) return idea.trim().length >= 8;
    if (!activeKey) return true;
    const draft = slots[activeKey];
    return draft.status === "answered" ? draft.value.trim().length > 0 : draft.status === "deferred" ? draft.reason.trim().length > 0 : false;
  }, [activeKey, idea, slots, step]);

  const updateSlot = (key: SlotKeyValue, patch: Partial<SlotDraft>) => {
    setSlots((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  const prefillFromIdea = () => {
    setSlots((current) => {
      const next = { ...current };
      if (next.offer.status === "unanswered") next.offer = { ...next.offer, status: "answered", value: idea.trim(), inferred: true };
      const audience = idea.match(/(?:for|to)\s+(.+?)(?:\.|$)/i)?.[1];
      if (audience && next.customer.status === "unanswered") next.customer = { ...next.customer, status: "answered", value: audience, inferred: true };
      return next;
    });
  };

  const next = () => {
    if (!canContinue) return;
    if (step === 0) prefillFromIdea();
    setStep((current) => Math.min(planStep, current + 1));
  };

  const submit = async () => {
    if (!disclosure || resolved !== SlotKey.options.length) return;
    setSubmitState("saving");
    setSubmitError("");
    try {
      idempotencyKey.current ??= crypto.randomUUID();
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: idempotencyKey.current, oneLiner: idea.trim(), slots, archetype, ownershipDisclosureAccepted: disclosure }),
      });
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(body);
        throw new Error(failure.success ? failure.data.error : "The build could not be queued.");
      }
      const receipt = z.object({ runId: z.string().uuid(), url: z.string().regex(/^\/runs\/[0-9a-f-]{36}$/) }).parse(body);
      setSubmitState("done");
      router.push(receipt.url);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The build could not be queued.");
      setSubmitState("error");
    }
  };

  return (
    <div className="k-intake-layout">
      <div className="k-intake-conversation">
        <div className="k-intake-progress"><span>Brief {resolved}/12</span><div className="k-progress"><div className="k-progress-fill" style={{ width: `${resolved / 12 * 100}%` }} /></div></div>
        {step === 0 ? (
          <Panel>
            <PanelHeader title="Start with the sentence you would tell a sharp friend" meta="The offline Interviewer uses it to pre-fill what it can, then asks only what remains." />
            <div className="k-panel-body">
              <Field label="The business idea" htmlFor="idea" required hint="Name the thing sold and, if you know it, who buys it.">
                <Textarea id="idea" rows={5} value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="I want to run a mobile bike repair service in Leeds for commuters who cannot lose a Saturday to a shop." />
              </Field>
            </div>
          </Panel>
        ) : activeKey ? (
          <Panel>
            <PanelHeader title={<span className="k-intake-question-number">{String(step).padStart(2, "0")} / 12 · {activeKey}</span>} meta={SLOT_QUESTIONS[activeKey]} />
            <div className="k-panel-body k-intake-answer">
              {slots[activeKey].inferred ? <Badge tone="info">Interviewer pre-fill — check it</Badge> : null}
              {slots[activeKey].status !== "deferred" ? <Field label="Your answer" htmlFor={`slot-${activeKey}`} required><Textarea id={`slot-${activeKey}`} rows={5} value={slots[activeKey].value} onChange={(event) => updateSlot(activeKey, { status: "answered", value: event.target.value, inferred: false })} placeholder="Specific beats polished. Names, numbers, and constraints are useful." /></Field> : <Field label="Why is it safe to defer this?" htmlFor={`defer-${activeKey}`} required hint="KILN will surface this assumption at the first relevant gate."><Textarea id={`defer-${activeKey}`} rows={4} value={slots[activeKey].reason} onChange={(event) => updateSlot(activeKey, { reason: event.target.value })} /></Field>}
              <Button variant="ghost" size="sm" onClick={() => updateSlot(activeKey, slots[activeKey].status === "deferred" ? { status: slots[activeKey].value ? "answered" : "unanswered", reason: "" } : { status: "deferred", reason: "", inferred: false })}>{slots[activeKey].status === "deferred" ? "Answer this instead" : "Defer with a reason"}</Button>
            </div>
          </Panel>
        ) : (
          <div className="k-plan-preview">
            <Panel>
              <PanelHeader title="Build plan" meta={`${plan.label} · guided autonomy`} />
              <div className="k-panel-body">
                <CostMeter spentMicros={0} budgetMicros={archetype === "physical" ? 12_000_000 : 9_000_000} elapsed="estimated" estimate={plan.duration} />
                <dl className="k-plan-facts"><div><dt>Duration</dt><dd>{plan.duration}</dd></div><div><dt>Internal cost</dt><dd>{plan.cost}</dd></div><div><dt>Hard gates</dt><dd>Brand, offer & price, spend, publish</dd></div></dl>
                <ol className="k-build-manifest">{plan.build.map((item) => <li key={item}>{item}</li>)}</ol>
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Managed ownership disclosure" meta="Required before KILN can provision anything." />
              <label className="k-disclosure"><input type="checkbox" checked={disclosure} onChange={(event) => setDisclosure(event.target.checked)} /><span>KILN will hold the storefront, domain, payment, email, and ad accounts it creates on my behalf. I can export my data at any time and start handover from the always-visible Handover page. The published handover target is five working days.</span></label>
            </Panel>
          </div>
        )}
        <div className="k-intake-actions">
          <Button variant="ghost" disabled={step === 0 || submitState === "saving"} onClick={() => setStep((current) => Math.max(0, current - 1))}>Back</Button>
          {step < planStep ? <Button variant="primary" disabled={!canContinue} onClick={next}>Continue</Button> : <Button variant="primary" disabled={!disclosure || resolved !== 12 || submitState === "saving" || submitState === "done"} onClick={() => void submit()}>{submitState === "saving" ? "Queuing plan…" : submitState === "done" ? "Plan queued" : "Start guided build"}</Button>}
          {submitState === "done" ? <span className="k-decision-ok">Run queued. Opening the theatre…</span> : submitState === "error" ? <span className="k-decision-stop">{submitError}</span> : null}
        </div>
      </div>
      <aside className="k-brief-live" aria-label="Live venture brief">
        <header><span>Live brief</span><Badge tone={resolved === 12 ? "positive" : "neutral"}>{resolved}/12</Badge></header>
        <p className="k-brief-idea">{idea || "Your opening sentence will stay here verbatim."}</p>
        <ol>{SlotKey.options.map((key, index) => { const draft = slots[key]; return <li key={key} data-status={draft.status}><button type="button" onClick={() => setStep(index + 1)} aria-label={`Edit ${key}`}><span>{key}</span><small>{draft.status === "answered" ? draft.value : draft.status === "deferred" ? `Deferred: ${draft.reason || "reason required"}` : "unanswered"}</small></button></li>; })}</ol>
      </aside>
    </div>
  );
}
