-- Grants, and forcing RLS to apply to the table owner.
--
-- Two Postgres behaviours make this file necessary, and both are easy to get
-- wrong in a way that produces a *silently* unprotected database:
--
--   1. A table's OWNER bypasses row-level security unless the table is marked
--      FORCE ROW LEVEL SECURITY. Migrations create these tables, so the
--      migrating role owns them, so without FORCE the policies in 0003 would
--      never fire for it.
--
--   2. A SUPERUSER bypasses RLS unconditionally, and FORCE does not change
--      that. Embedded Postgres connects as a superuser, so any test that
--      claims to prove tenant isolation must first `SET ROLE authenticated`.
--      packages/db/__tests__/rls.test.ts does exactly that, and asserts it is
--      no longer superuser before it trusts a single result.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts','users','mcp_tokens','ventures','runs','run_events','phases','tasks',
    'checkpoints','agent_invocations','tool_calls','spend_authorisations','budget_envelopes',
    'artifacts','assets','credentials','credential_leases','connections','plans','subscriptions',
    'credit_ledger','cost_ledger','stripe_events','metric_snapshots','orders_mirror','webhook_receipts',
    'daily_rollups','audit_log','abuse_reviews','break_glass_packets','job_queue','event_waiters'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT USAGE ON SCHEMA kiln TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kiln TO authenticated, service_role;

-- Sequences backing bigserial columns (run_events.seq) must be usable by the
-- role that inserts, or the append succeeds in policy and fails in permission.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
