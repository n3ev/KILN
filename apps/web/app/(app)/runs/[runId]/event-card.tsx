"use client";

import type { Checkpoint, RunEventRecord } from "@kiln/contracts";
import { ArtifactCard, Badge, StreamText } from "@kiln/ui";
import { CheckpointCard } from "../../../../components/checkpoint-card";
import type { ArtifactView } from "../../../../lib/view-contracts";
import type { TheatreTimelineItem } from "./theatre-state";

const pretty = (value: unknown): string => JSON.stringify(value, null, 2) ?? "null";
const clock = (iso: string) => new Date(iso).toISOString().slice(11, 19);

function shell(record: RunEventRecord, tone: string, title: string, children: React.ReactNode) {
  return <article className="k-event-card" data-tone={tone}><header><time>{clock(record.createdAt)}</time><span>{title}</span><code>#{record.seq}</code></header><div>{children}</div></article>;
}

export function TheatreEventCard({ item, events, checkpoints, artifacts, onArtifactSelect, onCheckpointDecided }: { item: TheatreTimelineItem; events: RunEventRecord[]; checkpoints: Map<string, Checkpoint>; artifacts: Map<string, ArtifactView>; onArtifactSelect: (id: string) => void; onCheckpointDecided: (id: string, status: "approved" | "rejected") => void }) {
  if (item.kind === "thinking") {
    return <article className="k-event-card" data-tone="agent"><header><time>{clock(item.createdAt)}</time><span>agent thinking</span><code>{item.taskId.slice(0, 8)}</code></header><StreamText text={item.text} complete={item.complete} /></article>;
  }
  const record = item.record;
  const event = record.payload;

  if (event.type === "tool.called") {
    const outcome = events.find(({ payload }) => (payload.type === "tool.succeeded" || payload.type === "tool.failed") && payload.toolCallId === event.toolCallId)?.payload;
    return shell(record, "tool", event.toolId, <details><summary>{outcome?.type === "tool.succeeded" ? `Succeeded · ${outcome.latencyMs}ms · ${outcome.costMicros}µ` : outcome?.type === "tool.failed" ? "Failed — inspect error" : "Running"}{event.sandboxed ? " · simulated" : ""}</summary><pre>{pretty({ input: event.input, outcome })}</pre></details>);
  }
  if (event.type === "artifact.written") {
    const artifact = artifacts.get(event.artifactId);
    return shell(record, "artifact", "artifact created", <ArtifactCard type={event.artifactType} version={event.version} status={artifact?.status ?? "loading"} quality={artifact?.quality} onSelect={() => onArtifactSelect(event.artifactId)} />);
  }
  if (event.type === "critic.rejected" || event.type === "critic.passed") {
    return shell(record, event.type === "critic.rejected" ? "critic-reject" : "critic-pass", "critic verdict", <div className="k-critic-verdict"><Badge tone={event.type === "critic.rejected" ? "critical" : "positive"}>{event.type === "critic.rejected" ? "rejected" : "passed"}</Badge><span>rubric cycle {event.cycle}</span>{event.type === "critic.rejected" ? <p>{event.summary}</p> : null}</div>);
  }
  if (event.type === "checkpoint.requested") {
    const checkpoint = checkpoints.get(event.checkpointId);
    return checkpoint ? <CheckpointCard checkpoint={checkpoint} compact onDecided={(status) => onCheckpointDecided(checkpoint.id, status)} /> : shell(record, "checkpoint", "checkpoint", <p>{event.title}</p>);
  }
  if (event.type === "human_directive") {
    return shell(record, "human", "customer directive", <div><p>{event.directive}</p><Badge tone="info">{event.applyAt === "current_phase" ? "current phase" : "next phase"}</Badge></div>);
  }
  if (event.type === "human_directive.applied") {
    const submitted = events.find(({ payload }) => payload.type === "human_directive" && payload.directiveId === event.directiveId)?.payload;
    return shell(record, "human", "Planner applied directive", <div><p>{submitted?.type === "human_directive" ? submitted.directive : "Customer instruction"}</p><Badge tone="positive">applied to {event.phaseKey}</Badge></div>);
  }
  if (event.type === "spend.authorised") {
    return shell(record, "spend", "spend authorised", <p><strong>{event.ceilingMicros.toLocaleString()}µ ceiling</strong> · {event.purpose}</p>);
  }
  if (event.type === "budget.reserved" || event.type === "budget.settled") {
    return shell(record, "spend", event.type.replace(".", " "), <pre>{pretty(event)}</pre>);
  }
  if (event.type === "agent.invoked") {
    return shell(record, "agent", event.agentId, <p>{event.provider} / {event.model}</p>);
  }
  if (event.type === "agent.completed") {
    return shell(record, "agent", "agent completed", <p>{event.promptTokens.toLocaleString()} prompt → {event.completionTokens.toLocaleString()} completion tokens · {event.latencyMs}ms · {event.costMicros.toLocaleString()}µ</p>);
  }
  if (event.type === "run.failed" && event.error["code"] === "COMPLIANCE_BLOCKED") {
    const context = event.error["context"];
    const findings = context && typeof context === "object" && Array.isArray((context as Record<string, unknown>)["findings"])
      ? ((context as Record<string, unknown>)["findings"] as unknown[]).filter((value): value is string => typeof value === "string")
      : [];
    return shell(record, "error", "compliance hard block", <div><p>{findings.join(" ") || "This business falls into a restricted category and cannot be built by KILN."}</p><p>No downstream build work was allowed to start. Unused build credits remain on the account.</p><a href="/billing?reason=compliance-block">Review billing or request a refund review</a></div>);
  }
  if (event.type === "notice" || event.type === "provider.degraded" || event.type === "lint.blocked" || event.type === "quality.evaluated" || event.type === "quality.overridden") {
    return shell(record, event.type === "notice" ? event.level : "system", event.type.replace(".", " "), <pre>{pretty(event)}</pre>);
  }
  const title = event.type.replace(".", " ");
  return shell(record, record.actor, title, <pre>{pretty(event)}</pre>);
}
