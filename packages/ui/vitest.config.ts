import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ui",
    environment: "jsdom",
    include: ["**/*.test.ts", "**/__tests__/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
