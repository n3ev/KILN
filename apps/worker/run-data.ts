import {
  ArtifactType,
  RunMemo,
  VentureBrief,
  parseArtifactContent,
  type RunMemo as RunMemoValue,
  type VentureBrief as VentureBriefValue,
} from "@kiln/contracts";
import { asServiceRole, getDb, rowsOf, type Database } from "@kiln/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

export const RunRow = z.object({
  id: z.string().uuid(),
  ventureId: z.string().uuid(),
  accountId: z.string().uuid(),
  playbookId: z.string().min(1),
  playbookVersion: z.string().min(1),
  autonomy: z.enum(["supervised", "guided", "autonomous"]),
  seed: z.string(),
  sandbox: z.boolean(),
  budgetMicros: z.coerce.number().int(),
  archetype: z.enum(["physical", "digital", "service"]),
  brief: z.unknown(),
  entitlements: z.unknown(),
});
export type RunRow = z.infer<typeof RunRow>;

interface ArtifactRow {
  type: string;
  content: unknown;
}

export interface LoadedRunData {
  readonly row: RunRow;
  readonly brief: VentureBriefValue;
  readonly memo: RunMemoValue;
  readonly artifacts: Partial<Record<ArtifactType, unknown>>;
}

export async function loadRunData(
  database: Database | undefined,
  runId: string,
): Promise<LoadedRunData> {
  const db = database ?? (await getDb());
  const loaded = await asServiceRole(db, async (tx) => {
    const row = rowsOf<RunRow>(
      await tx.execute(sql`
        SELECT r.id, r.venture_id AS "ventureId", v.account_id AS "accountId",
               r.playbook_id AS "playbookId", r.playbook_version AS "playbookVersion",
               r.autonomy::text AS autonomy, r.seed, r.sandbox,
               r.budget_micros AS "budgetMicros", v.archetype::text AS archetype,
               v.brief, plan.entitlements
        FROM runs r
        JOIN ventures v ON v.id = r.venture_id
        JOIN accounts account ON account.id = v.account_id
        LEFT JOIN plans plan ON plan.id = account.plan_id AND plan.active = true
        WHERE r.id = ${runId}
        LIMIT 1
      `),
    )[0];
    if (!row) return undefined;
    const artifacts = rowsOf<ArtifactRow>(
      await tx.execute(sql`
        SELECT DISTINCT ON (type) type, content
        FROM artifacts
        WHERE run_id = ${runId}
        ORDER BY type, version DESC
      `),
    );
    return { row, artifacts };
  });
  if (!loaded) throw new Error(`Run ${runId} was not found`);

  const row = RunRow.parse(loaded.row);
  const brief = VentureBrief.parse(row.brief);
  const artifacts: Partial<Record<ArtifactType, unknown>> = {};
  for (const artifact of loaded.artifacts) {
    const type = ArtifactType.parse(artifact.type);
    artifacts[type] = parseArtifactContent(type, artifact.content);
  }
  artifacts.venture_brief ??= brief;
  const memoResult = RunMemo.safeParse(artifacts.run_memo);
  return {
    row,
    brief,
    artifacts,
    memo: memoResult.success ? memoResult.data : RunMemo.parse({}),
  };
}
