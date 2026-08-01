import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));
process.env["KILN_PGDATA"] ??= resolve(here, "../../.kiln/vault-test-pgdata");
process.env["KILN_KEYFILE"] ??= resolve(here, "../../.kiln/vault-test-kek.key");

export default defineConfig({
  test: {
    name: "vault",
    environment: "node",
    include: ["**/*.test.ts", "**/__tests__/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    globalSetup: ["./__tests__/global-setup.ts"],
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    env: {
      KILN_PGDATA: process.env["KILN_PGDATA"],
      KILN_KEYFILE: process.env["KILN_KEYFILE"],
    },
  },
});
