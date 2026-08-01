import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "agents",
    environment: "node",
    include: ["**/*.test.ts", "**/__tests__/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
