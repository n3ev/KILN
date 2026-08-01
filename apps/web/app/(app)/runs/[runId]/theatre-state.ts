import type { RunEventRecord } from "@kiln/contracts";
import type { PhaseRailItem } from "@kiln/ui";

export type TheatreTimelineItem =
  | { kind: "record"; record: RunEventRecord }
  | { kind: "thinking"; id: string; taskId: string; text: string; createdAt: string; complete: boolean };

export function derivePhases(events: RunEventRecord[]): PhaseRailItem[] {
  const phases = new Map<string, PhaseRailItem>();
  for (const record of events) {
    const event = record.payload;
    if (event.type === "phase.started") {
      phases.set(event.phaseId, { id: event.phaseId, title: event.title || event.key, status: "running" });
    } else if (event.type === "phase.succeeded" || event.type === "phase.failed" || event.type === "phase.skipped") {
      const current = phases.get(event.phaseId) ?? { id: event.phaseId, title: "Unlabelled phase", status: "pending" as const };
      phases.set(event.phaseId, { ...current, status: event.type === "phase.succeeded" ? "succeeded" : event.type === "phase.failed" ? "failed" : "skipped" });
    }
  }
  return [...phases.values()];
}

export function deriveStatus(initial: string, events: RunEventRecord[]): string {
  let status = initial;
  const pending = new Set<string>();
  for (const { payload } of events) {
    if (payload.type === "run.started" || payload.type === "run.resumed") status = "running";
    if (payload.type === "run.paused") status = "paused";
    if (payload.type === "run.succeeded") status = "succeeded";
    if (payload.type === "run.failed") status = "failed";
    if (payload.type === "run.cancelled") status = "cancelled";
    if (payload.type === "checkpoint.requested") pending.add(payload.checkpointId);
    if (payload.type === "checkpoint.decided") pending.delete(payload.checkpointId);
  }
  return pending.size > 0 && !isTerminalStatus(status) ? "waiting_on_checkpoint" : status;
}

export function isTerminalStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/**
 * Preserve the rhythm of a recorded run while compressing approval/deploy idle
 * gaps. The selected multiplier remains exact after that idle-gap compression.
 */
export function replayDelayMs(previousIso: string | undefined, nextIso: string, speed: 1 | 4 | 16): number {
  if (!previousIso) return Math.max(5, Math.round(120 / speed));
  const recordedGap = Math.max(80, Date.parse(nextIso) - Date.parse(previousIso));
  const compressedGap = Math.min(1_500, recordedGap);
  return Math.max(5, Math.round(compressedGap / speed));
}

export function additionalSpend(events: RunEventRecord[], afterSeq: number): number {
  return events.reduce((total, record) => {
    if (record.seq <= afterSeq) return total;
    const event = record.payload;
    if (event.type === "agent.completed") return total + event.costMicros;
    if (event.type === "budget.settled") return total + event.actualMicros;
    return total;
  }, 0);
}

export function buildTimeline(events: RunEventRecord[]): TheatreTimelineItem[] {
  const items: TheatreTimelineItem[] = [];
  const thoughtIndex = new Map<string, number>();
  const completedTasks = new Set(events.flatMap(({ payload }) => payload.type === "agent.completed" ? [payload.taskId] : []));
  for (const record of events) {
    const event = record.payload;
    if (event.type === "tool.succeeded" || event.type === "tool.failed") continue;
    if (event.type === "agent.token") {
      const existingIndex = thoughtIndex.get(event.taskId);
      if (existingIndex === undefined) {
        thoughtIndex.set(event.taskId, items.length);
        items.push({ kind: "thinking", id: `thinking-${event.taskId}`, taskId: event.taskId, text: event.text, createdAt: record.createdAt, complete: completedTasks.has(event.taskId) });
      } else {
        const existing = items[existingIndex];
        if (existing?.kind === "thinking") items[existingIndex] = { ...existing, text: existing.text + event.text };
      }
      continue;
    }
    items.push({ kind: "record", record });
  }
  return items;
}
