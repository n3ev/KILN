import type { ReactNode } from "react";
import { cn } from "./cn.js";
import { formatMicros } from "./format.js";
import { Badge } from "./primitives.js";

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const width = 160;
  const height = 42;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length < 2 ? width / 2 : index * width / (values.length - 1);
    const y = height - ((value - min) / Math.max(1, max - min)) * height;
    return `${x},${y}`;
  }).join(" ");
  return <svg className="k-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}><polyline points={points} /></svg>;
}

export function Timeline({ items }: { items: Array<{ title: ReactNode; meta?: ReactNode; tone?: string }> }) {
  return <ol className="k-timeline">{items.map((item, index) => <li key={index} data-tone={item.tone}><span className="k-timeline-dot" /><div><div>{item.title}</div>{item.meta ? <div className="k-muted">{item.meta}</div> : null}</div></li>)}</ol>;
}

export function DiffView({ before, after }: { before: string; after: string }) {
  return <div className="k-diff"><pre data-side="before">{before}</pre><pre data-side="after">{after}</pre></div>;
}

export function StreamText({ text, complete = false }: { text: string; complete?: boolean }) {
  return (
    <details className="k-stream-text" open={!complete}>
      <summary>{complete ? "Agent reasoning · complete" : "Agent reasoning · streaming"}</summary>
      <p>{text || "Waiting for the first token…"}<span className="k-stream-caret" aria-hidden="true" /></p>
    </details>
  );
}

export function ArtifactCard({ type, version, status, selected, onSelect, quality }: { type: string; version: number; status?: string; selected?: boolean; onSelect?: () => void; quality?: { degraded?: boolean; overridden?: boolean; criticScore?: number } }) {
  return (
    <button className={cn("k-artifact-card", selected && "is-selected")} type="button" onClick={onSelect}>
      <span><strong>{type.replace(/_/g, " ")}</strong><small>version {version}</small></span>
      <span className="k-artifact-badges">{quality?.degraded ? <Badge tone="warning">degraded</Badge> : null}{quality?.overridden ? <Badge tone="critical">overridden</Badge> : null}{quality?.criticScore !== undefined ? <Badge tone="info">{quality.criticScore.toFixed(1)}/5</Badge> : null}{status ? <Badge>{status}</Badge> : null}</span>
    </button>
  );
}

export function CostMeter({ spentMicros, budgetMicros, elapsed, estimate }: { spentMicros: number; budgetMicros: number; elapsed?: string; estimate?: string }) {
  const percent = budgetMicros <= 0 ? 0 : Math.min(100, Math.round(spentMicros / budgetMicros * 100));
  return <div className="k-cost-meter"><div className="k-cost-copy"><span><strong>{formatMicros(spentMicros)}</strong> of {formatMicros(budgetMicros)}</span>{elapsed ? <span>{elapsed}{estimate ? ` / ${estimate}` : ""}</span> : null}</div><div className="k-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div className="k-progress-fill" style={{ width: `${percent}%` }} /></div></div>;
}

export interface PhaseRailItem { id: string; title: string; status: "pending" | "running" | "blocked" | "succeeded" | "failed" | "skipped" }
export function PhaseRail({ phases }: { phases: PhaseRailItem[] }) {
  return <ol className="k-phase-rail">{phases.map((phase, index) => <li key={phase.id} className="k-phase" data-status={phase.status}><span className="k-phase-index">{String(index + 1).padStart(2, "0")}</span><span className="k-phase-key">{phase.title}</span><span className="k-phase-status">{phase.status}</span></li>)}</ol>;
}
