import { expect, test, type Page } from "@playwright/test";
import { completedVentures, intakeFixture } from "./fixtures";

async function completeIntake(page: Page): Promise<void> {
  await page.goto("/intake");
  await page.getByLabel("The business idea").fill(intakeFixture.idea);
  await page.getByRole("button", { name: "Continue" }).click();

  for (const answer of intakeFixture.answers) {
    const field = page.locator(".k-intake-answer textarea");
    await expect(field).toBeVisible();
    await field.fill(answer);
    await page.getByRole("button", { name: "Continue" }).click();
  }

  await expect(page.getByRole("heading", { name: "Build plan" })).toBeVisible();
  await expect(page.getByText("12/12", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start guided build" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Start guided build" })).toBeEnabled();
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

  await completeIntake(page);
  await page.getByRole("button", { name: "Start guided build" }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}$/);

  await expect(page.getByRole("heading", { name: intakeFixture.ventureName })).toBeVisible();
  await expect(page.locator(".k-theatre")).toBeVisible();
  await expect(page.getByText("queued", { exact: true })).toBeVisible();
  await expect(page.getByText("Planner is preparing")).toBeVisible();
});

test("the intake-created run advances through the worker and makes that venture live", async ({ page }) => {
  test.fixme(true, "Embedded PGlite runs web-only, and run success currently does not project the newly created venture from building to live.");
  await page.goto("/runs");
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
  await expect(northstar).toContainText("queued");
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
