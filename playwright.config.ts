import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const pgdata = JSON.stringify(fileURLToPath(new URL("./.kiln/e2e-pgdata", import.meta.url)));
const offline = `KILN_PGDATA=${pgdata} MODEL_PROVIDER=mock MOCK_STREAM_JITTER_MS=0 KILN_SANDBOX=1`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? [["line"], ["html", { open: "never" }]] : "line",
  expect: { timeout: 10_000, toHaveScreenshot: { animations: "disabled", caret: "hide" } },
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    colorScheme: "dark",
    locale: "en-GB",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      `${offline} pnpm db:reset && ` +
      `${offline} pnpm db:push && ` +
      `${offline} pnpm seed && ` +
      `APP_URL=http://127.0.0.1:3101 NEXT_PUBLIC_APP_URL=http://127.0.0.1:3101 ${offline} pnpm --filter @kiln/web exec next dev -p 3101`,
    url: "http://127.0.0.1:3101",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
