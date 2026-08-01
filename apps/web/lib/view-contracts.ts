import { ArtifactQuality, ArtifactStatus, ArtifactType, Autonomy, RunStatus, safeParseArtifactContent } from "@kiln/contracts";
import { z } from "zod";

const Instant = z.string().datetime({ offset: true });

export const ArtifactQualityView = ArtifactQuality;

export const ArtifactView = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  type: ArtifactType,
  version: z.number().int().positive(),
  status: ArtifactStatus,
  content: z.unknown(),
  quality: ArtifactQualityView,
  createdAt: Instant,
}).superRefine((artifact, ctx) => {
  const content = safeParseArtifactContent(artifact.type, artifact.content);
  if (content.success) return;
  for (const issue of content.issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["content", ...issue.path.split(".").filter(Boolean)],
      message: issue.message,
    });
  }
});
export type ArtifactView = z.infer<typeof ArtifactView>;

export const RunView = z.object({
  id: z.string().uuid(),
  ventureId: z.string().uuid(),
  ventureName: z.string().min(1),
  playbookId: z.string().min(1),
  status: RunStatus,
  autonomy: Autonomy,
  currentPhase: z.string().nullable(),
  spentMicros: z.number().int(),
  budgetMicros: z.number().int(),
  startedAt: Instant.nullable(),
  endedAt: Instant.nullable(),
});
export type RunView = z.infer<typeof RunView>;
