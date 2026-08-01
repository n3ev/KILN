-- Row-level security on every tenant table.
--
-- Tenancy is by ACCOUNT. Tables that carry account_id compare it directly;
-- everything below a venture reaches it through an EXISTS join, which stays
-- index-backed because ventures.account_id and the child foreign keys are both
-- indexed. Every policy also admits kiln.is_service_role() for the worker.
--
-- Cross-tenant reads are asserted to fail in packages/db/__tests__/rls.test.ts.
-- If you add a tenant table, add it here and add it to that test.

-- ── Direct account ownership ────────────────────────────────────────────────

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounts_tenant ON accounts;
CREATE POLICY accounts_tenant ON accounts
  USING (kiln.is_service_role() OR id = kiln.current_account_id())
  WITH CHECK (kiln.is_service_role() OR id = kiln.current_account_id());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_tenant ON users;
CREATE POLICY users_tenant ON users
  USING (kiln.is_service_role() OR account_id = kiln.current_account_id())
  WITH CHECK (kiln.is_service_role() OR account_id = kiln.current_account_id());

ALTER TABLE mcp_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_tokens_tenant ON mcp_tokens;
CREATE POLICY mcp_tokens_tenant ON mcp_tokens
  USING (kiln.is_service_role() OR account_id = kiln.current_account_id())
  WITH CHECK (kiln.is_service_role() OR account_id = kiln.current_account_id());

ALTER TABLE ventures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ventures_tenant ON ventures;
CREATE POLICY ventures_tenant ON ventures
  USING (kiln.is_service_role() OR account_id = kiln.current_account_id())
  WITH CHECK (kiln.is_service_role() OR account_id = kiln.current_account_id());

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_tenant ON subscriptions;
CREATE POLICY subscriptions_tenant ON subscriptions
  USING (kiln.is_service_role() OR account_id = kiln.current_account_id())
  WITH CHECK (kiln.is_service_role() OR account_id = kiln.current_account_id());

ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_ledger_tenant ON credit_ledger;
CREATE POLICY credit_ledger_tenant ON credit_ledger
  USING (kiln.is_service_role() OR account_id = kiln.current_account_id())
  WITH CHECK (kiln.is_service_role() OR account_id = kiln.current_account_id());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_tenant ON audit_log;
CREATE POLICY audit_log_tenant ON audit_log
  USING (kiln.is_service_role() OR account_id = kiln.current_account_id())
  WITH CHECK (kiln.is_service_role() OR account_id = kiln.current_account_id());

ALTER TABLE abuse_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS abuse_reviews_tenant ON abuse_reviews;
CREATE POLICY abuse_reviews_tenant ON abuse_reviews
  USING (kiln.is_service_role() OR account_id = kiln.current_account_id())
  WITH CHECK (kiln.is_service_role() OR account_id = kiln.current_account_id());

-- ── Reached through a venture ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION kiln.owns_venture(v uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  -- Do not call kiln.is_service_role() here. SECURITY DEFINER changes
  -- current_user to the function owner; if a service role owned the function,
  -- that shortcut would make this predicate true for every caller. The actual
  -- service role bypasses RLS before policies run and needs no shortcut here.
  SELECT EXISTS (
    SELECT 1 FROM public.ventures
    WHERE ventures.id = v AND ventures.account_id = kiln.current_account_id()
  );
$$;

ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS runs_tenant ON runs;
CREATE POLICY runs_tenant ON runs
  USING (kiln.owns_venture(venture_id)) WITH CHECK (kiln.owns_venture(venture_id));

ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artifacts_tenant ON artifacts;
CREATE POLICY artifacts_tenant ON artifacts
  USING (kiln.owns_venture(venture_id)) WITH CHECK (kiln.owns_venture(venture_id));

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assets_tenant ON assets;
CREATE POLICY assets_tenant ON assets
  USING (kiln.owns_venture(venture_id)) WITH CHECK (kiln.owns_venture(venture_id));

ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connections_tenant ON connections;
CREATE POLICY connections_tenant ON connections
  USING (kiln.owns_venture(venture_id)) WITH CHECK (kiln.owns_venture(venture_id));

ALTER TABLE metric_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metric_snapshots_tenant ON metric_snapshots;
CREATE POLICY metric_snapshots_tenant ON metric_snapshots
  USING (kiln.owns_venture(venture_id)) WITH CHECK (kiln.owns_venture(venture_id));

ALTER TABLE orders_mirror ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_mirror_tenant ON orders_mirror;
CREATE POLICY orders_mirror_tenant ON orders_mirror
  USING (kiln.owns_venture(venture_id)) WITH CHECK (kiln.owns_venture(venture_id));

ALTER TABLE daily_rollups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS daily_rollups_tenant ON daily_rollups;
CREATE POLICY daily_rollups_tenant ON daily_rollups
  USING (kiln.owns_venture(venture_id)) WITH CHECK (kiln.owns_venture(venture_id));

ALTER TABLE break_glass_packets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS break_glass_tenant ON break_glass_packets;
CREATE POLICY break_glass_tenant ON break_glass_packets
  USING (kiln.owns_venture(venture_id)) WITH CHECK (kiln.owns_venture(venture_id));

-- ── Reached through a run ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION kiln.owns_run(r uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.runs JOIN public.ventures ON ventures.id = runs.venture_id
    WHERE runs.id = r AND ventures.account_id = kiln.current_account_id()
  );
$$;

ALTER TABLE run_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS run_events_tenant ON run_events;
CREATE POLICY run_events_tenant ON run_events
  USING (kiln.owns_run(run_id)) WITH CHECK (kiln.owns_run(run_id));

ALTER TABLE phases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phases_tenant ON phases;
CREATE POLICY phases_tenant ON phases
  USING (kiln.owns_run(run_id)) WITH CHECK (kiln.owns_run(run_id));

ALTER TABLE checkpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checkpoints_tenant ON checkpoints;
CREATE POLICY checkpoints_tenant ON checkpoints
  USING (kiln.owns_run(run_id)) WITH CHECK (kiln.owns_run(run_id));

ALTER TABLE tool_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tool_calls_tenant ON tool_calls;
CREATE POLICY tool_calls_tenant ON tool_calls
  USING (kiln.owns_run(run_id)) WITH CHECK (kiln.owns_run(run_id));

ALTER TABLE cost_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_ledger_tenant ON cost_ledger;
CREATE POLICY cost_ledger_tenant ON cost_ledger
  USING (kiln.owns_run(run_id)) WITH CHECK (kiln.owns_run(run_id));

ALTER TABLE budget_envelopes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_envelopes_tenant ON budget_envelopes;
CREATE POLICY budget_envelopes_tenant ON budget_envelopes
  USING (kiln.owns_run(run_id)) WITH CHECK (kiln.owns_run(run_id));

ALTER TABLE spend_authorisations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spend_auth_tenant ON spend_authorisations;
CREATE POLICY spend_auth_tenant ON spend_authorisations
  USING (kiln.owns_run(run_id)) WITH CHECK (kiln.owns_run(run_id));

-- ── Reached through a phase, then a run ─────────────────────────────────────

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tasks_tenant ON tasks;
CREATE POLICY tasks_tenant ON tasks
  USING (
    kiln.is_service_role()
    OR EXISTS (SELECT 1 FROM phases WHERE phases.id = tasks.phase_id AND kiln.owns_run(phases.run_id))
  )
  WITH CHECK (
    kiln.is_service_role()
    OR EXISTS (SELECT 1 FROM phases WHERE phases.id = tasks.phase_id AND kiln.owns_run(phases.run_id))
  );

ALTER TABLE agent_invocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_invocations_tenant ON agent_invocations;
CREATE POLICY agent_invocations_tenant ON agent_invocations
  USING (
    kiln.is_service_role()
    OR EXISTS (
      SELECT 1 FROM tasks JOIN phases ON phases.id = tasks.phase_id
      WHERE tasks.id = agent_invocations.task_id AND kiln.owns_run(phases.run_id)
    )
  )
  WITH CHECK (kiln.is_service_role());

-- ── Credentials: no tenant read path at all ─────────────────────────────────
--
-- Deliberately service-role only. A credential's ciphertext must never be
-- reachable from a customer session even in principle, so there is no USING
-- clause admitting kiln.current_account_id(). packages/vault runs as the
-- service role inside the tool execution boundary; nothing else touches it.

ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credentials_service_only ON credentials;
CREATE POLICY credentials_service_only ON credentials
  USING (kiln.is_service_role()) WITH CHECK (kiln.is_service_role());

ALTER TABLE credential_leases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credential_leases_service_only ON credential_leases;
CREATE POLICY credential_leases_service_only ON credential_leases
  USING (kiln.is_service_role()) WITH CHECK (kiln.is_service_role());

-- ── Infrastructure tables: service role only ────────────────────────────────

ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_queue_service_only ON job_queue;
CREATE POLICY job_queue_service_only ON job_queue
  USING (kiln.is_service_role()) WITH CHECK (kiln.is_service_role());

ALTER TABLE event_waiters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_waiters_service_only ON event_waiters;
CREATE POLICY event_waiters_service_only ON event_waiters
  USING (kiln.is_service_role()) WITH CHECK (kiln.is_service_role());

ALTER TABLE webhook_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_receipts_service_only ON webhook_receipts;
CREATE POLICY webhook_receipts_service_only ON webhook_receipts
  USING (kiln.is_service_role()) WITH CHECK (kiln.is_service_role());

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stripe_events_service_only ON stripe_events;
CREATE POLICY stripe_events_service_only ON stripe_events
  USING (kiln.is_service_role()) WITH CHECK (kiln.is_service_role());

-- plans is a public catalogue: readable by anyone, writable only by service.
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_readable ON plans;
CREATE POLICY plans_readable ON plans FOR SELECT USING (true);
DROP POLICY IF EXISTS plans_writable ON plans;
CREATE POLICY plans_writable ON plans FOR ALL
  USING (kiln.is_service_role()) WITH CHECK (kiln.is_service_role());
