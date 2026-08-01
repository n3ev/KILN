import { defineWorkspace } from "vitest/config";

/**
 * Every package owns its own vitest project so suites stay fast and isolated.
 * `pnpm test` at the root runs all of them.
 */
export default defineWorkspace([
  "packages/*/vitest.config.ts",
  "tests/vitest.config.ts",
]);
