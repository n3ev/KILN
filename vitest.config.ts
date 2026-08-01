import { defineConfig } from "vitest/config";

/** Vitest 4 does not auto-load the legacy workspace file. */
export default defineConfig({
  test: {
    name: "unit-and-integration",
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/evals/**/*.test.ts", "tests/security/**/*.test.ts", "tests/contracts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "packages/runtime/**/*.ts",
        "packages/tools/core/**/*.ts",
        "packages/billing/**/*.ts",
        "packages/vault/**/*.ts",
      ],
      exclude: ["**/__tests__/**", "**/*.test.ts", "**/scripts/**", "**/index.ts"],
      thresholds: {
        lines: 80,
        "packages/runtime/**": { lines: 80 },
        "packages/tools/core/**": { lines: 80 },
        "packages/billing/**": { lines: 80 },
        "packages/vault/**": { lines: 80 },
      },
    },
  },
});
