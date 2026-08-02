import { join } from "node:path";
import { repoRoot } from "../client.js";

/**
 * Loads the repo-root `.env` for scripts run through pnpm.
 *
 * Import this FIRST in any script that touches the database. Nothing else in
 * the repo does it: `packages/config/env.ts` reads `process.env` as given, and
 * `scripts/dev.sh` sources `.env` only for the long-running processes. A script
 * invoked as `pnpm db:push` therefore inherits whatever the shell happens to
 * hold, and with no DATABASE_URL the driver silently selects embedded PGlite.
 *
 * That failure is the dangerous kind: db:push and seed both report success,
 * having written a complete schema and a full seed to a different database than
 * the one the app is configured to use. It cost an evening of "but I seeded it"
 * before `db:doctor` showed the RLS roles missing from the real server.
 *
 * loadEnvFile does not overwrite a variable the shell already exported, so an
 * explicit `DATABASE_URL=... pnpm db:push` still wins.
 */
try {
  process.loadEnvFile(join(repoRoot(), ".env"));
} catch {
  // No .env is legitimate: the zero-key path runs entirely on defaults.
}
