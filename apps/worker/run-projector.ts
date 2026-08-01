import type { RunEvent } from "@kiln/contracts";
import type { Database } from "@kiln/db";
import { sql } from "drizzle-orm";

/** Maintains disposable read models beside the append-only event write. */
export async function projectRunEvent(
  tx: Database,
  runId: string,
  event: RunEvent,
  at: string,
): Promise<void> {
  switch (event.type) {
    case "run.started":
      await tx.execute(sql`
        UPDATE runs SET status = 'running', playbook_id = ${event.playbookId},
          playbook_version = ${event.playbookVersion}, autonomy = ${event.autonomy},
          seed = ${event.seed}, budget_micros = ${event.budgetMicros},
          started_at = COALESCE(started_at, ${at}), ended_at = NULL
        WHERE id = ${runId}
      `);
      return;
    case "run.resumed":
      await tx.execute(sql`UPDATE runs SET status = 'running', ended_at = NULL WHERE id = ${runId}`);
      return;
    case "run.paused":
      await tx.execute(sql`UPDATE runs SET status = 'paused' WHERE id = ${runId}`);
      return;
    case "run.cancelled":
      await tx.execute(sql`UPDATE runs SET status = 'cancelled', ended_at = ${at} WHERE id = ${runId}`);
      return;
    case "run.succeeded":
      await tx.execute(sql`UPDATE runs SET status = 'succeeded', ended_at = ${at} WHERE id = ${runId}`);
      return;
    case "run.failed":
      await tx.execute(sql`UPDATE runs SET status = 'failed', ended_at = ${at} WHERE id = ${runId}`);
      return;
    case "run.autonomy_changed":
      await tx.execute(sql`UPDATE runs SET autonomy = ${event.to} WHERE id = ${runId}`);
      return;
    case "phase.started":
      await tx.execute(sql`
        INSERT INTO phases (id, run_id, key, title, status, order_index, started_at)
        VALUES (${event.phaseId}, ${runId}, ${event.key}, ${event.title}, 'running',
          (SELECT count(*)::int FROM phases WHERE run_id = ${runId}), ${at})
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, status = 'running',
          started_at = EXCLUDED.started_at, ended_at = NULL
      `);
      await tx.execute(sql`
        UPDATE runs SET status = 'running', current_phase = ${event.key}, ended_at = NULL
        WHERE id = ${runId} AND status <> 'cancelled'
      `);
      return;
    case "phase.succeeded":
      await tx.execute(sql`UPDATE phases SET status = 'succeeded', ended_at = ${at} WHERE id = ${event.phaseId}`);
      return;
    case "phase.failed":
      await tx.execute(sql`UPDATE phases SET status = 'failed', ended_at = ${at} WHERE id = ${event.phaseId}`);
      return;
    case "phase.skipped":
      await tx.execute(sql`UPDATE phases SET status = 'skipped', ended_at = ${at} WHERE id = ${event.phaseId}`);
      return;
    case "task.started":
      await tx.execute(sql`
        INSERT INTO tasks (id, phase_id, agent_id, title, status, attempt)
        VALUES (${event.taskId}, ${event.phaseId}, ${event.agentId}, ${event.title}, 'running', ${event.attempt})
        ON CONFLICT (id) DO UPDATE SET status = 'running', attempt = EXCLUDED.attempt,
          error = NULL, output_artifact_id = NULL
      `);
      return;
    case "task.succeeded":
      await tx.execute(sql`
        UPDATE tasks SET status = 'succeeded', output_artifact_id = ${event.artifactId ?? null}
        WHERE id = ${event.taskId}
      `);
      return;
    case "task.failed":
      await tx.execute(sql`
        UPDATE tasks SET status = 'failed', error = ${JSON.stringify(event.error)}::jsonb
        WHERE id = ${event.taskId}
      `);
      return;
    case "checkpoint.requested":
      await tx.execute(sql`UPDATE runs SET status = 'waiting_on_checkpoint' WHERE id = ${runId}`);
      return;
    case "checkpoint.decided":
      if (event.status === "rejected") {
        await tx.execute(sql`UPDATE runs SET status = 'paused' WHERE id = ${runId}`);
        return;
      }
      await tx.execute(sql`
        UPDATE runs SET status = CASE
          WHEN EXISTS (SELECT 1 FROM checkpoints WHERE run_id = ${runId} AND status = 'pending')
            THEN 'waiting_on_checkpoint'::run_status ELSE 'running'::run_status END
        WHERE id = ${runId}
      `);
      return;
    case "agent.invoked":
      await tx.execute(sql`
        INSERT INTO agent_invocations
          (task_id, agent_id, model, provider, messages, status, created_at)
        VALUES (${event.taskId}, ${event.agentId}, ${event.model}, ${event.provider}, '[]'::jsonb,
          'running', ${at})
      `);
      return;
    case "agent.completed":
      await tx.execute(sql`
        WITH target AS (
          SELECT id FROM agent_invocations
          WHERE task_id = ${event.taskId} AND status = 'running'
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE
        )
        UPDATE agent_invocations AS invocation SET
          prompt_tokens = ${event.promptTokens},
          completion_tokens = ${event.completionTokens},
          cost_micros = ${event.costMicros},
          latency_ms = ${event.latencyMs},
          status = 'succeeded'
        FROM target WHERE invocation.id = target.id
      `);
      await tx.execute(sql`
        UPDATE runs SET spent_micros = spent_micros + ${event.costMicros} WHERE id = ${runId}
      `);
      return;
    default:
      return;
  }
}
