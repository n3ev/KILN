import { rowsOf, type Database } from "@kiln/db";
import { sql } from "drizzle-orm";

/**
 * What a customer data export actually contains.
 *
 * Every statement selects an explicit column list rather than `SELECT *`. That
 * is deliberate: `*` means a column added later silently joins the export, and
 * the one time that matters is the time the new column holds a token. Anything
 * that slips through is caught by account-export-scrub.ts.
 */

type DataRow = Record<string, unknown>;

export interface AccountExport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly accountId: string;
  readonly security: {
    readonly excluded: readonly string[];
    readonly note: string;
  };
  readonly data: Readonly<Record<string, readonly DataRow[]>>;
}

function dataRows(result: unknown): DataRow[] {
  return rowsOf<DataRow>(result);
}

export async function exportFrom(tx: Database, accountId: string, userId: string, generatedAt: string): Promise<AccountExport> {
  await tx.execute(sql`
    INSERT INTO audit_log (account_id, actor, action, subject_type, subject_id, metadata)
    VALUES (${accountId}, ${`user:${userId}`}, 'account.data_exported', 'account', ${accountId},
      ${JSON.stringify({ schemaVersion: 1 })}::jsonb)
  `);

  // Each SELECT is an explicit allowlist. In particular, this service never
  // reads credentials, credential leases, MCP token hashes, packet envelopes,
  // signed URLs, or raw webhook storage pointers.
  const account = dataRows(await tx.execute(sql`
    SELECT id, name, plan_id, status, autonomy_default, budget_weekly_cents,
      kyc_status, kyc_verified_at, stripe_customer_id,
      break_glass_key_algorithm, break_glass_key_fingerprint_sha256,
      break_glass_key_registered_at, created_at
    FROM accounts WHERE id = ${accountId}
  `));
  const users = dataRows(await tx.execute(sql`
    SELECT id, email, name, role, auth_uid, created_at
    FROM users WHERE account_id = ${accountId} ORDER BY created_at
  `));
  const mcpTokenDescriptors = dataRows(await tx.execute(sql`
    SELECT id, label, scopes, rate_limit_per_minute, last_used_at, expires_at, revoked_at, created_at
    FROM mcp_tokens WHERE account_id = ${accountId} ORDER BY created_at
  `));
  const ventures = dataRows(await tx.execute(sql`
    SELECT id, name, archetype, status, ownership_mode, brief, primary_domain, created_at
    FROM ventures WHERE account_id = ${accountId} ORDER BY created_at
  `));
  const runs = dataRows(await tx.execute(sql`
    SELECT r.id, r.venture_id, r.playbook_id, r.playbook_version, r.status, r.autonomy,
      r.current_phase, r.budget_micros, r.spent_micros, r.seed, r.sandbox,
      r.started_at, r.ended_at, r.created_at
    FROM runs r JOIN ventures v ON v.id = r.venture_id
    WHERE v.account_id = ${accountId} ORDER BY r.created_at
  `));
  const runEvents = dataRows(await tx.execute(sql`
    SELECT e.id, e.run_id, e.seq, e.type, e.payload, e.actor, e.created_at
    FROM run_events e JOIN runs r ON r.id = e.run_id JOIN ventures v ON v.id = r.venture_id
    WHERE v.account_id = ${accountId} ORDER BY e.seq
  `));
  const phases = dataRows(await tx.execute(sql`
    SELECT p.id, p.run_id, p.key, p.title, p.status, p.order_index, p.started_at, p.ended_at
    FROM phases p JOIN runs r ON r.id = p.run_id JOIN ventures v ON v.id = r.venture_id
    WHERE v.account_id = ${accountId} ORDER BY p.run_id, p.order_index
  `));
  const tasks = dataRows(await tx.execute(sql`
    SELECT t.id, t.phase_id, t.agent_id, t.title, t.status, t.attempt, t.input,
      t.output_artifact_id, t.error, t.created_at
    FROM tasks t JOIN phases p ON p.id = t.phase_id JOIN runs r ON r.id = p.run_id
      JOIN ventures v ON v.id = r.venture_id
    WHERE v.account_id = ${accountId} ORDER BY t.created_at
  `));
  const invocations = dataRows(await tx.execute(sql`
    SELECT i.id, i.task_id, i.agent_id, i.model, i.provider, i.messages,
      i.prompt_tokens, i.completion_tokens, i.cost_micros, i.latency_ms,
      i.status, i.error, i.created_at
    FROM agent_invocations i JOIN tasks t ON t.id = i.task_id JOIN phases p ON p.id = t.phase_id
      JOIN runs r ON r.id = p.run_id JOIN ventures v ON v.id = r.venture_id
    WHERE v.account_id = ${accountId} ORDER BY i.created_at
  `));
  const toolCalls = dataRows(await tx.execute(sql`
    SELECT c.id, c.task_id, c.run_id, c.tool_id, c.tool_version, c.input, c.output,
      c.status, c.external_cost_micros, c.latency_ms, c.sandboxed,
      c.authorisation_id, c.error, c.created_at
    FROM tool_calls c JOIN runs r ON r.id = c.run_id JOIN ventures v ON v.id = r.venture_id
    WHERE v.account_id = ${accountId} ORDER BY c.created_at
  `));
  const checkpoints = dataRows(await tx.execute(sql`
    SELECT c.id, c.run_id, c.phase_id, c.kind, c.title, c.prompt, c.options,
      c.status, c.decided_by_user_id, c.decision, c.expires_at, c.decided_at, c.created_at
    FROM checkpoints c JOIN runs r ON r.id = c.run_id JOIN ventures v ON v.id = r.venture_id
    WHERE v.account_id = ${accountId} ORDER BY c.created_at
  `));
  const spendAuthorisations = dataRows(await tx.execute(sql`
    SELECT a.id, a.run_id, a.purpose, a.ceiling_micros, a.currency, a.quote_id,
      a.category, a.granted_by_user_id, a.standing, a.expires_at,
      a.consumed_by_tool_call_id, a.created_at
    FROM spend_authorisations a JOIN runs r ON r.id = a.run_id JOIN ventures v ON v.id = r.venture_id
    WHERE v.account_id = ${accountId} ORDER BY a.created_at
  `));
  const budgetEnvelopes = dataRows(await tx.execute(sql`
    SELECT b.id, b.run_id, b.category, b.limit_micros, b.reserved_micros, b.spent_micros
    FROM budget_envelopes b JOIN runs r ON r.id = b.run_id JOIN ventures v ON v.id = r.venture_id
    WHERE v.account_id = ${accountId} ORDER BY b.run_id, b.category
  `));
  const artifacts = dataRows(await tx.execute(sql`
    SELECT a.id, a.venture_id, a.run_id, a.type, a.version, a.parent_id, a.status,
      a.content, a.content_hash, a.quality, a.sources, a.created_by_task_id, a.created_at
    FROM artifacts a JOIN ventures v ON v.id = a.venture_id
    WHERE v.account_id = ${accountId} ORDER BY a.created_at
  `));
  const assets = dataRows(await tx.execute(sql`
    SELECT a.id, a.venture_id, a.kind, a.provider, a.external_id, a.display_name,
      a.ownership_mode, a.status, a.metadata, a.provisioned_at, a.created_at
    FROM assets a JOIN ventures v ON v.id = a.venture_id
    WHERE v.account_id = ${accountId} ORDER BY a.created_at
  `));
  const connections = dataRows(await tx.execute(sql`
    SELECT c.id, c.venture_id, c.provider, c.asset_id, c.status, c.last_sync_at,
      c.sync_cursor, c.health, c.created_at
    FROM connections c JOIN ventures v ON v.id = c.venture_id
    WHERE v.account_id = ${accountId} ORDER BY c.created_at
  `));
  const subscriptions = dataRows(await tx.execute(sql`
    SELECT id, plan_id, stripe_subscription_id, status, current_period_end, cancel_at, created_at
    FROM subscriptions WHERE account_id = ${accountId} ORDER BY created_at
  `));
  const creditLedger = dataRows(await tx.execute(sql`
    SELECT id, run_id, delta_micros, kind, reason, metadata, created_at
    FROM credit_ledger WHERE account_id = ${accountId} ORDER BY created_at
  `));
  const costLedger = dataRows(await tx.execute(sql`
    SELECT l.id, l.run_id, l.category, l.ref_id, l.amount_micros, l.vendor, l.created_at
    FROM cost_ledger l JOIN runs r ON r.id = l.run_id JOIN ventures v ON v.id = r.venture_id
    WHERE v.account_id = ${accountId} ORDER BY l.created_at
  `));
  const metricSnapshots = dataRows(await tx.execute(sql`
    SELECT m.id, m.venture_id, m.provider, m.metric_key, m.ts, m.value,
      m.dimensions, m.currency, m.created_at
    FROM metric_snapshots m JOIN ventures v ON v.id = m.venture_id
    WHERE v.account_id = ${accountId} ORDER BY m.ts
  `));
  const orders = dataRows(await tx.execute(sql`
    SELECT o.id, o.venture_id, o.provider, o.external_id, o.placed_at, o.gross_cents,
      o.net_cents, o.currency, o.items, o.customer_ref, o.status, o.created_at
    FROM orders_mirror o JOIN ventures v ON v.id = o.venture_id
    WHERE v.account_id = ${accountId} ORDER BY o.placed_at
  `));
  const dailyRollups = dataRows(await tx.execute(sql`
    SELECT d.id, d.venture_id, d.day, d.metric_key, d.value, d.created_at
    FROM daily_rollups d JOIN ventures v ON v.id = d.venture_id
    WHERE v.account_id = ${accountId} ORDER BY d.day
  `));
  const auditLog = dataRows(await tx.execute(sql`
    SELECT id, actor, action, subject_type, subject_id, ip, user_agent, metadata, created_at
    FROM audit_log WHERE account_id = ${accountId} ORDER BY created_at
  `));
  const abuseReviews = dataRows(await tx.execute(sql`
    SELECT id, venture_id, run_id, category, reason, status, evidence,
      reviewed_by_user_id, decision_note, decided_at, created_at
    FROM abuse_reviews WHERE account_id = ${accountId} ORDER BY created_at
  `));
  const handoverPackets = dataRows(await tx.execute(sql`
    SELECT p.id, p.venture_id, p.artifact_id, p.recipient_key_fingerprint_sha256,
      p.algorithm, p.status, p.packet_checksum_sha256, p.emailed_to, p.created_at
    FROM break_glass_packets p JOIN ventures v ON v.id = p.venture_id
    WHERE v.account_id = ${accountId} ORDER BY p.created_at
  `));

  return {
    schemaVersion: 1,
    generatedAt,
    accountId,
    security: {
      excluded: [
        "vault credentials and credential leases",
        "MCP token hashes and bearer tokens",
        "break-glass ciphertext, signed URLs, and private keys",
        "raw webhook payload pointers and infrastructure queue payloads",
      ],
      note: "Provider credentials are intentionally absent. Nested persisted content is secret-scrubbed again when serialized.",
    },
    data: {
      account, users, mcpTokenDescriptors, ventures, runs, runEvents, phases, tasks,
      invocations, toolCalls, checkpoints, spendAuthorisations, budgetEnvelopes,
      artifacts, assets, connections, subscriptions, creditLedger, costLedger,
      metricSnapshots, orders, dailyRollups, auditLog, abuseReviews, handoverPackets,
    },
  };
}
