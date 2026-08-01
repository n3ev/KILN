"use client";

import { HumanDirectiveReceipt, RunEventRecord, type Checkpoint, type RunEventRecord as RunEventRecordValue } from "@kiln/contracts";
import { ArtifactCard, Badge, Button, CostMeter, Empty, Field, Panel, PanelHeader, PhaseRail, Tabs, Textarea } from "@kiln/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArtifactView, type ArtifactView as ArtifactValue, type RunView } from "../../../../lib/view-contracts";
import { ArtifactReading } from "./artifact-reading";
import { TheatreEventCard } from "./event-card";
import { additionalSpend, buildTimeline, derivePhases, deriveStatus, isTerminalStatus, replayDelayMs } from "./theatre-state";

const duration = (millis: number) => {
  const minutes = Math.max(0, Math.floor(millis / 60_000));
  return minutes < 60 ? `${minutes}m elapsed` : `${Math.floor(minutes / 60)}h ${minutes % 60}m elapsed`;
};

const estimateFor = (playbook: string) => playbook === "physical-shopify" ? "90m estimate" : playbook === "digital-product" ? "70m estimate" : "75m estimate";

export function EventStream({ run, initialEvents, initialArtifacts, initialCheckpoints }: { run: RunView; initialEvents: RunEventRecordValue[]; initialArtifacts: ArtifactValue[]; initialCheckpoints: Checkpoint[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [checkpoints, setCheckpoints] = useState(initialCheckpoints);
  const [connection, setConnection] = useState<"connecting" | "live" | "reconnecting" | "complete" | "error">(isTerminalStatus(run.status) ? "complete" : "connecting");
  const [selectedArtifactId, setSelectedArtifactId] = useState(initialArtifacts.at(-1)?.id);
  const [directive, setDirective] = useState("");
  const [directiveState, setDirectiveState] = useState<"idle" | "sending" | "queued" | "error">("idle");
  const [directiveQueuedFor, setDirectiveQueuedFor] = useState<"current_phase" | "next_phase">();
  const [replayMode, setReplayMode] = useState(false);
  const [replayActive, setReplayActive] = useState(false);
  const [replayCursor, setReplayCursor] = useState(initialEvents.length);
  const [replaySpeed, setReplaySpeed] = useState<1 | 4 | 16>(4);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const initialLastSeq = useRef(Math.max(-1, ...initialEvents.map((event) => event.seq)));
  const knownArtifactIds = useRef(new Set(initialArtifacts.map((artifact) => artifact.id)));
  const loadingArtifactIds = useRef(new Set<string>());
  const audioContext = useRef<AudioContext | null>(null);
  const lastAudiblePhaseSeq = useRef(Math.max(-1, ...initialEvents.filter(({ payload }) => payload.type === "phase.succeeded").map(({ seq }) => seq)));
  const lastReplaySelectionSeq = useRef(-1);

  const visibleEvents = useMemo(() => replayMode ? events.slice(0, replayCursor) : events, [events, replayCursor, replayMode]);
  const status = deriveStatus(replayMode ? "queued" : run.status, visibleEvents);
  const phases = useMemo(() => derivePhases(visibleEvents), [visibleEvents]);
  const timeline = useMemo(() => buildTimeline(visibleEvents), [visibleEvents]);
  const artifactMap = useMemo(() => new Map(artifacts.map((artifact) => [artifact.id, artifact])), [artifacts]);
  const replayArtifactIds = useMemo(() => new Set<string>(visibleEvents.flatMap(({ payload }) => payload.type === "artifact.written" ? [payload.artifactId] : [])), [visibleEvents]);
  const mountedArtifacts = replayMode ? artifacts.filter((artifact) => replayArtifactIds.has(artifact.id)) : artifacts;
  const checkpointMap = useMemo(() => new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint])), [checkpoints]);
  const selectedArtifact = selectedArtifactId && (!replayMode || replayArtifactIds.has(selectedArtifactId)) ? artifactMap.get(selectedArtifactId) : undefined;
  const spent = run.spentMicros + additionalSpend(events, initialLastSeq.current);
  const elapsedEnd = run.endedAt ? Date.parse(run.endedAt) : now;
  const elapsed = run.startedAt ? duration(elapsedEnd - Date.parse(run.startedAt)) : "not started";

  useEffect(() => {
    if (run.endedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [run.endedAt]);

  useEffect(() => {
    if (!replayActive) return;
    if (replayCursor >= events.length) {
      setReplayActive(false);
      return;
    }
    const previous = replayCursor > 0 ? events[replayCursor - 1]?.createdAt : undefined;
    const next = events[replayCursor];
    if (!next) return;
    const timer = window.setTimeout(() => setReplayCursor((cursor) => Math.min(events.length, cursor + 1)), replayDelayMs(previous, next.createdAt, replaySpeed));
    return () => window.clearTimeout(timer);
  }, [events, replayActive, replayCursor, replaySpeed]);

  useEffect(() => {
    if (!replayMode) return;
    for (const record of visibleEvents) {
      if (record.seq <= lastReplaySelectionSeq.current) continue;
      if (record.payload.type === "artifact.written") setSelectedArtifactId(record.payload.artifactId);
      lastReplaySelectionSeq.current = record.seq;
    }
  }, [replayMode, visibleEvents]);

  useEffect(() => {
    if (!audioEnabled) return;
    const newest = [...visibleEvents].reverse().find(({ payload, seq }) => payload.type === "phase.succeeded" && seq > lastAudiblePhaseSeq.current);
    if (!newest) return;
    lastAudiblePhaseSeq.current = newest.seq;
    const Context = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    audioContext.current ??= new Context();
    const context = audioContext.current;
    void context.resume().then(() => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(523.25, context.currentTime);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.34);
    }).catch(() => undefined);
  }, [audioEnabled, visibleEvents]);

  useEffect(() => () => {
    const context = audioContext.current;
    audioContext.current = null;
    void context?.close();
  }, []);

  useEffect(() => {
    if (isTerminalStatus(run.status)) return;
    const source = new EventSource(`/api/runs/${run.id}/stream?after=${initialLastSeq.current}`);
    const loadArtifact = async (artifactId: string) => {
      if (knownArtifactIds.current.has(artifactId) || loadingArtifactIds.current.has(artifactId)) return;
      loadingArtifactIds.current.add(artifactId);
      try {
        const response = await fetch(`/api/runs/${run.id}/artifacts/${artifactId}`, { cache: "no-store" });
        if (!response.ok) return;
        const parsed = ArtifactView.safeParse(await response.json());
        if (!parsed.success) return;
        knownArtifactIds.current.add(parsed.data.id);
        setArtifacts((current) => [...current.filter((artifact) => artifact.id !== parsed.data.id), parsed.data]);
        setSelectedArtifactId(parsed.data.id);
      } catch {
        setConnection("error");
      } finally {
        loadingArtifactIds.current.delete(artifactId);
      }
    };
    source.onopen = () => setConnection("live");
    source.onerror = () => setConnection("reconnecting");
    source.addEventListener("stream-error", () => setConnection("error"));
    source.addEventListener("run-event", (message) => {
      let decoded: unknown;
      try { decoded = JSON.parse((message as MessageEvent<string>).data) as unknown; }
      catch { setConnection("error"); return; }
      const parsed = RunEventRecord.safeParse(decoded);
      if (!parsed.success || parsed.data.runId !== run.id) { setConnection("error"); return; }
      const record = parsed.data;
      setEvents((current) => current.some((event) => event.seq === record.seq) ? current : [...current, record].sort((a, b) => a.seq - b.seq));
      if (record.payload.type === "artifact.written") void loadArtifact(record.payload.artifactId);
      if (record.payload.type === "run.succeeded" || record.payload.type === "run.failed" || record.payload.type === "run.cancelled") {
        setConnection("complete");
        source.close();
      }
    });
    return () => source.close();
  }, [run.id, run.status]);

  const sendDirective = async () => {
    const text = directive.trim();
    if (!text) return;
    setDirectiveState("sending");
    try {
      const response = await fetch(`/api/runs/${run.id}/interventions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ directiveId: crypto.randomUUID(), directive: text }) });
      if (!response.ok) throw new Error("directive rejected");
      const receipt = HumanDirectiveReceipt.safeParse(await response.json());
      if (!receipt.success || receipt.data.runId !== run.id) throw new Error("invalid directive receipt");
      setDirective("");
      setDirectiveQueuedFor(receipt.data.applyAt);
      setDirectiveState("queued");
    } catch { setDirectiveState("error"); }
  };

  const startReplay = () => {
    lastReplaySelectionSeq.current = -1;
    lastAudiblePhaseSeq.current = -1;
    setSelectedArtifactId(undefined);
    setReplayCursor(0);
    setReplayMode(true);
    setReplayActive(true);
  };

  const toggleAudio = () => {
    if (!audioEnabled) {
      lastAudiblePhaseSeq.current = Math.max(-1, ...visibleEvents.filter(({ payload }) => payload.type === "phase.succeeded").map(({ seq }) => seq));
    }
    setAudioEnabled((enabled) => !enabled);
  };

  return (
    <>
      <div className="k-theatre-heading">
        <div><h1 className="k-page-title">{run.ventureName}</h1><p className="k-page-lede">{run.playbookId} · {run.autonomy} autonomy</p></div>
        <div className="k-run-state"><Badge tone={status === "succeeded" ? "positive" : status === "failed" ? "critical" : status === "waiting_on_checkpoint" ? "warning" : "accent"}>{status.replace(/_/g, " ")}</Badge><span className="k-connection" data-state={connection}>{connection}</span></div>
      </div>
      <div className="k-theatre-chrome">
        <CostMeter spentMicros={spent} budgetMicros={run.budgetMicros} elapsed={elapsed} estimate={estimateFor(run.playbookId)} />
        <div className="k-replay-controls" aria-label="Run playback controls">
          {isTerminalStatus(status) ? <>
            <Button size="sm" variant="secondary" onClick={() => replayActive ? setReplayActive(false) : replayMode && replayCursor < events.length ? setReplayActive(true) : startReplay()}>
              {replayActive ? "Pause replay" : replayMode && replayCursor < events.length ? "Resume replay" : "Replay run"}
            </Button>
            {([1, 4, 16] as const).map((speed) => <Button key={speed} size="sm" variant={replaySpeed === speed ? "primary" : "ghost"} aria-pressed={replaySpeed === speed} onClick={() => setReplaySpeed(speed)}>{speed}×</Button>)}
            {replayMode ? <Button size="sm" variant="ghost" onClick={() => { setReplayActive(false); setReplayCursor(events.length); }}>Show complete</Button> : null}
          </> : null}
          <Button size="sm" variant="ghost" aria-pressed={audioEnabled} onClick={toggleAudio}>Phase tone {audioEnabled ? "on" : "off"}</Button>
        </div>
      </div>
      <div className="k-theatre">
        <Panel className="k-theatre-rail"><PanelHeader title="Phases" meta={`${phases.filter((phase) => phase.status === "succeeded" || phase.status === "skipped").length} of ${phases.length} complete`} />{phases.length ? <PhaseRail phases={phases} /> : <Empty title="Planner is preparing" body="The rail is reconstructed from phase events." />}</Panel>
        <div className="k-theatre-centre">
          <Panel><PanelHeader title="Build stream" meta={`${visibleEvents.length}${replayMode ? ` of ${events.length}` : ""} validated events · ${replayActive ? `replaying ${replaySpeed}×` : connection}`} /><div className="k-event-feed">{timeline.length ? timeline.map((item) => <TheatreEventCard key={item.kind === "thinking" ? item.id : item.record.id} item={item} events={visibleEvents} checkpoints={checkpointMap} artifacts={artifactMap} onArtifactSelect={setSelectedArtifactId} onCheckpointDecided={(id, status) => setCheckpoints((current) => current.map((checkpoint) => checkpoint.id === id ? { ...checkpoint, status } : checkpoint))} />) : <Empty title={replayMode ? "Replay ready" : "Quiet so far"} body={replayMode ? "Playback will reveal each validated event in sequence." : "The first typed event will appear here."} />}</div></Panel>
          <Panel className="k-intervention"><PanelHeader title="Intervene" meta="The Planner applies it now when safe, otherwise at the next phase boundary." /><div className="k-panel-body"><Field label="Instruction" htmlFor="directive"><Textarea id="directive" rows={2} value={directive} onChange={(event) => { setDirective(event.target.value); setDirectiveState("idle"); }} placeholder="Make the packaging brief less minimal." /></Field><div className="k-intervention-actions"><Button variant="primary" size="sm" disabled={!directive.trim() || directiveState === "sending" || isTerminalStatus(status)} onClick={() => void sendDirective()}>{directiveState === "sending" ? "Routing…" : "Send to Planner"}</Button>{directiveState === "queued" ? <span className="k-decision-ok">{directiveQueuedFor === "current_phase" ? "Queued for the current phase" : "Queued for the next phase"}</span> : directiveState === "error" ? <span className="k-decision-stop">Could not route the instruction</span> : isTerminalStatus(status) ? <span className="k-muted">This run is complete</span> : null}</div></div></Panel>
        </div>
        <Panel className="k-artifact-panel"><PanelHeader title="Artifacts" meta={`${mountedArtifacts.length} mounted`} /><div className="k-artifact-list">{mountedArtifacts.map((artifact) => <ArtifactCard key={artifact.id} type={artifact.type} version={artifact.version} status={artifact.status} selected={selectedArtifactId === artifact.id} quality={artifact.quality} onSelect={() => setSelectedArtifactId(artifact.id)} />)}</div>{selectedArtifact ? <div className="k-artifact-preview"><Tabs items={[{ id: "preview", label: "Reading view", content: <article className="k-artifact-reading"><header><h3>{selectedArtifact.type.replace(/_/g, " ")}</h3><p>Version {selectedArtifact.version} · {selectedArtifact.status}</p></header><ArtifactReading artifact={selectedArtifact} /></article> }, { id: "raw", label: "Raw JSON", content: <pre className="k-json-view">{JSON.stringify(selectedArtifact, null, 2)}</pre> }]} /></div> : <Empty title="Select an artifact" body="New artifacts mount here as their events arrive." />}</Panel>
      </div>
    </>
  );
}
