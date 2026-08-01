import { getArtifact, getRun } from "../../../../../../lib/queries";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string; artifactId: string }> }) {
  const { runId, artifactId } = await params;
  if (!await getRun(runId)) return Response.json({ error: "Run not found." }, { status: 404 });
  const artifact = await getArtifact(runId, artifactId);
  return artifact ? Response.json(artifact, { headers: { "cache-control": "no-store" } }) : Response.json({ error: "Artifact not found." }, { status: 404 });
}
