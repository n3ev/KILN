-- run_events and audit_log are append-only.
--
-- The event log is the source of truth for a run: current state is a pure fold
-- over it, and `pnpm run:replay` re-executes it to reproduce an artifact set.
-- Both properties are worthless if a row can be edited after the fact, so this
-- is enforced by the database rather than by code review.

-- Account erasure is the sole exception. A permanent, service-only permit row
-- binds one account to one transaction id. A custom GUC is deliberately not
-- used: authenticated sessions can forge arbitrary custom settings. The
-- account lifecycle service inserts and removes this permit in the same
-- transaction, and any rollback removes it automatically.
CREATE TABLE IF NOT EXISTS kiln.account_deletion_permits (
  transaction_id bigint PRIMARY KEY,
  account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE kiln.account_deletion_permits FROM PUBLIC, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE kiln.account_deletion_permits TO service_role;

CREATE OR REPLACE FUNCTION kiln.reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  permitted_account uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT account_id INTO permitted_account
    FROM kiln.account_deletion_permits
    WHERE transaction_id = txid_current();

    IF permitted_account IS NOT NULL THEN
      IF TG_TABLE_NAME = 'audit_log' AND OLD.account_id = permitted_account THEN
        RETURN OLD;
      END IF;
      IF TG_TABLE_NAME = 'run_events' AND EXISTS (
        SELECT 1 FROM public.runs r JOIN public.ventures v ON v.id = r.venture_id
        WHERE r.id = OLD.run_id AND v.account_id = permitted_account
      ) THEN
        RETURN OLD;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION
    '% is append-only: % on % is not permitted', TG_TABLE_NAME, TG_OP, TG_TABLE_NAME
    USING HINT = 'Correct a mistaken event by appending a compensating event.';
END
$$;

DROP TRIGGER IF EXISTS run_events_no_update ON run_events;
CREATE TRIGGER run_events_no_update
  BEFORE UPDATE ON run_events
  FOR EACH ROW EXECUTE FUNCTION kiln.reject_mutation();

DROP TRIGGER IF EXISTS run_events_no_delete ON run_events;
CREATE TRIGGER run_events_no_delete
  BEFORE DELETE ON run_events
  FOR EACH ROW EXECUTE FUNCTION kiln.reject_mutation();

-- The audit log carries the same guarantee for the same reason.
DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION kiln.reject_mutation();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION kiln.reject_mutation();
