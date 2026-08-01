import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

/**
 * Can a worker run beside the web app?
 *
 * Only if they can share a database, and embedded PGlite cannot be shared —
 * it takes an exclusive lock on its data directory. So this asks whether there
 * is a Postgres: one the operator supplied, or the docker-compose service.
 *
 * Decided here rather than in the server script because the specs need the
 * answer too, and Playwright hands this process's environment to the workers
 * that run them.
 */
function sharedDatabaseAvailable(): boolean {
  if (process.env["DATABASE_URL"]) return true;
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (sharedDatabaseAvailable()) process.env["KILN_E2E_WORKER"] = "1";

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
  // Brings up the database, the worker, and the web app — see
  // scripts/e2e-server.sh. The worker is what lets a run created from intake
  // advance at all, which is what the two previously-fixme'd specs need.
  webServer: {
    command: "bash scripts/e2e-server.sh",
    url: "http://127.0.0.1:3101",
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
