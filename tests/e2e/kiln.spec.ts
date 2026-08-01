import { expect, test, type Page } from "@playwright/test";
import { completedVentures, intakeFixture } from "./fixtures";

/**
 * Whether a worker is executing runs beside the web app.
 *
 * False only when the machine has neither DATABASE_URL nor Docker, because
 * embedded PGlite admits one process and so cannot be shared. playwright.config
 * decides this and scripts/e2e-server.sh starts the worker to match. CI has
 * Docker, so the specs below run there; a developer without either gets a
 * stated skip instead of a failure about a missing service.
 */
const workerRuns = process.env["KILN_E2E_WORKER"] === "1";
const needsWorker = "Needs a worker sharing the database: set DATABASE_URL or start Docker.";

/**
 * The offer answer becomes the venture's name. Specs that each start a build
 * pass a distinct suffix so their ventures are told apart in the sidebar —
 * without it every run in the suite produces an identically named venture and
 * a locator has to guess which one it meant.
 */
const OFFER_ANSWER_INDEX = 2;

async function completeIntake(page: Page, nameSuffix = ""): Promise<void> {
  await page.goto("/intake");
  await page.getByLabel("The business idea").fill(intakeFixture.idea);
  await page.getByRole("button", { name: "Continue" }).click();

  for (const [index, answer] of intakeFixture.answers.entries()) {
    const field = page.locator(".k-intake-answer textarea");
    await expect(field).toBeVisible();
    await field.fill(index === OFFER_ANSWER_INDEX ? `${answer}${nameSuffix}` : answer);
    await page.getByRole("button", { name: "Continue" }).click();
  }

  await expect(page.getByRole("heading", { name: "Build plan" })).toBeVisible();
  await expect(page.getByText("12/12", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start guided build" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Start guided build" })).toBeEnabled();
}

/** Intake through to the Run Theatre, where the worker picks the run up. */
async function startIntakeRun(page: Page, nameSuffix = ""): Promise<string> {
  const ventureName = `${intakeFixture.ventureName}${nameSuffix}`;
  await completeIntake(page, nameSuffix);
  await page.getByRole("button", { name: "Start guided build" }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}$/);
  await expect(page.locator(".k-theatre")).toBeVisible();
  await expect(page.getByRole("heading", { name: ventureName })).toBeVisible();
  return ventureName;
}

interface TheatreSnapshot {
  phaseTitles: string[];
  phaseStatuses: string[];
  events: string[];
  artifacts: string[];
}

/** Everything the theatre derives from the event log, in render order. */
async function theatreSnapshot(page: Page): Promise<TheatreSnapshot> {
  return {
    phaseTitles: await page.locator(".k-phase .k-phase-key").allTextContents(),
    phaseStatuses: await page.locator(".k-phase .k-phase-status").allTextContents(),
    events: await page.locator(".k-event-card").allTextContents(),
    artifacts: await page.locator(".k-artifact-panel .k-artifact-card").allTextContents(),
  };
}

test("marketing is concrete and routes into the product", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("KILN builds and runs it");
  await expect(page.getByRole("link", { name: "Start a build" })).toHaveAttribute("href", "/intake");
  await expect(page.getByText("What it will not do")).toBeVisible();
});

test("a new production customer signs up and establishes a tenant session", async ({ page }) => {
  test.fixme(true, "The auth route currently documents offline bypass; it has no signup form or wired Supabase Auth bridge.");
  await page.goto("/login");
});

test("offline identity disclosure leads through intake into a durable queued run", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText(/authentication is bypassed/i)).toBeVisible();

  await startIntakeRun(page, " (queued)");

  // With a worker sharing the database it claims the job within a poll
  // interval, so the run is durable and either still queued or already picked
  // up. Pinning it to `queued` would only assert that nothing runs.
  await expect(page.locator(".k-run-state .k-badge")).toHaveText(
    workerRuns ? /^(queued|running)$/ : /^queued$/,
  );
});

test("the intake-created run advances through the worker and makes that venture live", async ({ page }) => {
  test.skip(!workerRuns, needsWorker);
  test.setTimeout(420_000);
  const ventureName = await startIntakeRun(page, " (launch)");

  await expect(page.locator(".k-run-state .k-badge")).toHaveText("succeeded", { timeout: 360_000 });
  await expect(page.locator(".k-artifact-panel .k-artifact-card").first()).toBeVisible();

  // Reach the venture through two real navigations rather than clicking. The
  // sidebar is rendered by the layout, which a soft navigation reuses, so it
  // still lists whatever existed when the shell first rendered — and any link
  // that was prefetched while the run was going carries a cached `building`
  // payload. Either would make this spec report on the wrong state.
  await page.goto("/ventures");
  const row = page.locator(".k-row").filter({ hasText: ventureName });
  const ventureHref = await row.getByRole("link", { name: ventureName, exact: true }).getAttribute("href");
  expect(ventureHref).toMatch(/^\/ventures\/[0-9a-f-]{36}$/);
  // Intake writes the venture as `building`; a completed build is the only
  // thing that moves it (apps/worker/run-projector.ts).
  await expect(row).toContainText("live");

  await page.goto(ventureHref as string);
  await expect(page.getByRole("heading", { name: ventureName })).toBeVisible();
  await expect(page.getByText("live", { exact: true })).toBeVisible();
  await expect(page.getByText("Revenue yesterday")).toBeVisible();
});

test("reloading mid-run reconstructs identical state from the event log", async ({ page }) => {
  test.skip(!workerRuns, needsWorker);
  test.setTimeout(420_000);
  await startIntakeRun(page, " (mid-run)");

  // Mid-run, literally: streaming, with structure and at least one artifact
  // already mounted, and nowhere near a terminal status.
  await expect(page.locator(".k-run-state .k-badge")).toHaveText("running", { timeout: 240_000 });
  await expect(page.locator(".k-artifact-panel .k-artifact-card").first()).toBeVisible({ timeout: 240_000 });
  await expect(page.locator(".k-event-card").nth(8)).toBeVisible({ timeout: 240_000 });

  const before = await theatreSnapshot(page);
  const status = await page.locator(".k-run-state .k-badge").textContent();
  expect(status).not.toContain("succeeded");
  expect(status).not.toContain("failed");

  await page.reload();
  await expect(page.locator(".k-theatre")).toBeVisible();
  await expect(page.locator(".k-event-card").nth(before.events.length - 1)).toBeVisible();
  const after = await theatreSnapshot(page);

  // The log is append-only, so everything that had settled when the snapshot
  // was taken must come back byte-identical at the same position. Three kinds
  // of card are excluded because they were still in flight, which the markup
  // states rather than leaves to guesswork: the final card may still be
  // receiving tokens, a tool card reads "Running" until its outcome event
  // lands, and an artifact card reads "loading" until its fetch resolves.
  const settled = before.events
    .map((text, index) => ({ text, index }))
    .slice(0, -1)
    .filter(({ text }) => !text.includes("Running") && !text.includes("loading"));
  expect(settled.length).toBeGreaterThan(5);
  expect(settled.map(({ index }) => after.events[index])).toEqual(settled.map(({ text }) => text));

  // The phase rail and the artifact panel are folds over the same log: the run
  // may have advanced, but it cannot have rewritten what was already there.
  expect(after.phaseTitles.slice(0, before.phaseTitles.length)).toEqual(before.phaseTitles);
  expect(after.artifacts.slice(0, before.artifacts.length)).toEqual(before.artifacts);
  for (const [index, phaseStatus] of before.phaseStatuses.entries()) {
    if (phaseStatus === "succeeded") expect(after.phaseStatuses[index]).toBe("succeeded");
  }
});

test("a customer approves a blocking checkpoint and the decision survives navigation", async ({ page }) => {
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  await expect(page.getByText("Approve the brand direction")).toBeVisible();
  const approve = page.getByRole("button", { name: /approve selection/i });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText("Approved and recorded")).toBeVisible();

  await page.goto("/runs");
  const northstar = page.locator(".k-row").filter({ hasText: "Northstar Planters" });
  // The decision is what has to survive, not the status. With a worker
  // attached the approval releases the run, which then advances to the next
  // hard gate; with no worker it stays parked. Both mean the same thing here:
  // the approval was recorded and the run is not terminal.
  await expect(northstar).toContainText(
    workerRuns ? /queued|running|waiting on checkpoint/ : /queued/,
  );
  await page.goto("/approvals");
  await expect(page.getByText("Approve the brand direction")).toHaveCount(0);
});

test("a completed run reconstructs identically and leads to a live venture dashboard", async ({ page }) => {
  await page.goto("/runs");
  await page.getByRole("main").getByRole("link", { name: "Ember & Ash", exact: true }).click();
  await expect(page.locator(".k-theatre")).toBeVisible();
  await expect(page.getByText("succeeded", { exact: true }).first()).toBeVisible();

  const phasesBefore = await page.locator(".k-phase").allTextContents();
  const eventsBefore = await page.locator(".k-event-card").count();
  const artifactsBefore = await page.locator(".k-artifact-card").count();
  expect(phasesBefore.length).toBeGreaterThan(0);
  expect(eventsBefore).toBeGreaterThan(0);
  expect(artifactsBefore).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator(".k-theatre")).toBeVisible();
  expect(await page.locator(".k-phase").allTextContents()).toEqual(phasesBefore);
  expect(await page.locator(".k-event-card").count()).toBe(eventsBefore);
  expect(await page.locator(".k-artifact-card").count()).toBe(artifactsBefore);

  await page.getByRole("link", { name: "Ember & Ash", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Ember & Ash" })).toBeVisible();
  await expect(page.getByText("live", { exact: true })).toBeVisible();
  await expect(page.getByText("Revenue yesterday")).toBeVisible();
  await expect(page.getByText("Orders, 30 days")).toBeVisible();
});

test("billing checkout remains simulated without external keys", async ({ page }) => {
  await page.goto("/billing");
  await expect(page.getByText("Studio").first()).toBeVisible();
  await expect(page.getByText("active", { exact: true }).first()).toBeVisible();

  const founder = page.locator(".k-panel").filter({ has: page.getByRole("heading", { name: "Founder" }) });
  await founder.getByRole("button", { name: "Choose plan" }).click();
  await expect(page).toHaveURL(/\/billing\?.*mock_checkout=cs_test_/);
});

test("handover remains visible and states its published service target", async ({ page }) => {
  await page.goto("/handover");
  await expect(page.getByRole("heading", { name: "Handover" })).toBeVisible();
  await expect(page.getByText(/always available, never gated/i)).toBeVisible();
  await expect(page.getByText(/five working days/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Handover" })).toBeVisible();
});

test("design gallery renders the primitive visual baseline", async ({ page }) => {
  await page.goto("/console/design");
  await expect(page.getByRole("heading", { name: "Design gallery" })).toBeVisible();
  await expect(page.getByText("Actions and states")).toBeVisible();
  await expect(page).toHaveScreenshot("design-gallery.png", { fullPage: true });
});

for (const venture of completedVentures) {
  test(`${venture.archetype} brand artifact has a stable generated preview`, async ({ page }) => {
    await page.goto("/runs");
    await page.getByRole("main").getByRole("link", { name: venture.name, exact: true }).click();
    await page.addStyleTag({
      content: ".k-theatre-chrome,.k-theatre-rail,.k-artifact-panel{position:static!important;max-height:none!important;overflow:visible!important}",
    });
    await page.getByRole("button", { name: /brand system/i }).last().click();

    const preview = page.locator(".k-artifact-preview");
    const brand = preview.locator(".k-brand-reading");
    await expect(brand).toBeVisible();
    await expect(brand.getByText("Chosen direction")).toBeVisible();
    await brand.scrollIntoViewIfNeeded();
    await expect(brand).toHaveScreenshot(`brand-preview-${venture.playbook}.png`);
  });
}

test("continuous export and an actionable handover start complete the customer journey", async ({ page }) => {
  test.fixme(true, "The current UI has neither a customer export action nor an actionable handover start; /handover is informational only.");
  await page.goto("/handover");
});

test("card decline enters grace, pauses after seven days, and recovers after payment", async ({ page }) => {
  test.fixme(true, "Prompt-one billing persists past_due, but the grace timer, read-only pause, recovery UI, and visible banner are explicit prompt-3 stubs.");
  await page.goto("/billing");
});
