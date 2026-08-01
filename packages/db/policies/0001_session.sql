-- Session bridge for row-level security.
--
-- Supabase policies normally read `auth.uid()`, but KILN scopes tenancy by
-- ACCOUNT, not by user, and has to run identically against embedded Postgres
-- where the `auth` schema does not exist. So the web layer opens every request
-- by setting a session GUC, and policies read that.
--
--   SET LOCAL kiln.account_id = '<uuid>';
--
-- `SET LOCAL` scopes it to the transaction, which is what makes a pooled
-- connection safe: the setting cannot leak into the next request's queries.

CREATE SCHEMA IF NOT EXISTS kiln;

CREATE OR REPLACE FUNCTION kiln.current_account_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('kiln.account_id', true), '')::uuid;
$$;

-- True only after the connection has assumed the real Postgres service_role.
--
-- Do not replace this with a custom GUC. Any database role can set a custom
-- two-part setting, so a check such as current_setting('kiln.service_role')
-- lets an authenticated session promote itself. Workers use SET LOCAL ROLE
-- service_role inside a transaction (packages/db/client.ts); authenticated is
-- deliberately not a member of that role.
CREATE OR REPLACE FUNCTION kiln.is_service_role() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_user = 'service_role';
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
  ELSE
    -- An existing deployment role must not retain an accidental bypass bit.
    ALTER ROLE authenticated NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  ELSE
    ALTER ROLE service_role BYPASSRLS;
  END IF;
END
$$;

-- Membership is the only way a non-superuser could assume the bypass role.
-- Revoke it explicitly so reapplying policies repairs a misconfigured database.
REVOKE service_role FROM authenticated;
