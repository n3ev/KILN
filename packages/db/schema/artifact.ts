import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { artifactStatus, createdAt } from "./_shared.js";
import { runs, tasks } from "./run.js";
import { ventures } from "./venture.js";

/**
 * Artifacts are content-addressed and immutable.
 *
 * A revision writes a new row with `version + 1` and `parentId` pointing at the
 * one it supersedes; the old row is marked `superseded` but never edited. That
 * is what makes replay meaningful — the artifact set at any point in a run is
 * reconstructible, and a prompt change can be diffed against what it replaced.
 */
export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id")
      .notNull()
      .references(() => ventures.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    version: integer("version").notNull().default(1),
    parentId: uuid("parent_id"),
    status: artifactStatus("status").notNull().default("draft"),
    /** Validated against ARTIFACT_SCHEMAS[type] before it is ever written. */
    content: jsonb("content").notNull(),
    /** sha256 over canonical JSON. Two identical artifacts share a hash. */
    contentHash: text("content_hash").notNull(),
    storageKey: text("storage_key"),
    /** ArtifactQuality: degraded, overridden, critic score, lint result. */
    quality: jsonb("quality").notNull().default({}),
    sources: jsonb("sources").notNull().default([]),
    createdByTaskId: uuid("created_by_task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("artifacts_run_type_version_idx").on(t.runId, t.type, t.version),
    index("artifacts_venture_type_idx").on(t.ventureId, t.type),
    index("artifacts_hash_idx").on(t.contentHash),
    index("artifacts_status_idx").on(t.status),
  ],
);

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  venture: one(ventures, { fields: [artifacts.ventureId], references: [ventures.id] }),
  run: one(runs, { fields: [artifacts.runId], references: [runs.id] }),
  createdByTask: one(tasks, { fields: [artifacts.createdByTaskId], references: [tasks.id] }),
}));
