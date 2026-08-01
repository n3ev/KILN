import { notFound } from "next/navigation";
import { getRun, listArtifacts, listRunCheckpoints, listRunEvents } from "../../../../lib/queries";
import { EventStream } from "./event-stream";

export const dynamic = "force-dynamic";

export default async function RunTheatre({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) notFound();
  const [events, artifacts, checkpoints] = await Promise.all([listRunEvents(runId), listArtifacts(runId), listRunCheckpoints(runId)]);
  return <EventStream run={run} initialEvents={events} initialArtifacts={artifacts} initialCheckpoints={checkpoints} />;
}
