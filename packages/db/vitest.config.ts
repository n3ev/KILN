import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Set on the real process object, not just `test.env`: globalSetup runs in the
 * Vitest main process and does not see `test.env`, but it is the hook that
 * provisions the database the workers then connect to. Both need the same path.
 */
process.env["KILN_PGDATA"] ??= resolve(here, "../../.kiln/test-pgdata");

export default defineConfig({
  test: {
    name: "db",
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    globalSetup: ["./__tests__/global-setup.ts"],
    // The embedded engine takes an exclusive lock on its data directory, so the
    // suite runs in one process. Forks rather than threads because the PGlite
    // WASM module does not survive being shared across worker threads.
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    env: { KILN_PGDATA: process.env["KILN_PGDATA"] },
  },
});
