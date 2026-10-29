import { expect, type Page, test } from "@playwright/test";

// T-025 — website editor E2E (06 §W3, packet acceptance criteria 1-5).
// Runs against the seeded demo tenant (`st-josephs-demo`); the "home"
// page already has a published v1 from scripts/seed/sections/website.ts
// (T-024), so these specs edit that page rather than create a new one.
// NOT RUN by this packet's author — the lead runs e2e later (packet rule).
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const SLUG = "st-josephs-demo";

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForLoadState("networkidle");
}

async function openHomePageEditor(page: Page) {
  await page.goto(`/${SLUG}/website`);
  await page.getByRole("link", { name: "Home" }).click();
  await page.waitForLoadState("networkidle");
}

test.describe("T-025: website editor", () => {
  test("admin edits the hero heading, saves a new version; live site is unchanged until publish", async ({
    page,
    request,
  }) => {
    const uniqueHeading = `Welcome ${crypto.randomUUID()}`;

    await loginAs(page, "admin@demo.coolskool.test");
    await openHomePageEditor(page);

    const headingInput = page.locator("input").first();
    await headingInput.fill(uniqueHeading);
    await page.getByRole("button", { name: "Save as new version" }).click();
    await expect(page.getByText(/Saved as version/)).toBeVisible();

    // Live site (anon, no session) must still show the old content.
    const liveResponse = await request.get(`/s/${SLUG}`);
    const liveBody = await liveResponse.text();
    expect(liveBody).not.toContain(uniqueHeading);
  });

  test("publishing the new version updates the live site within one reload, and VersionList marks it published", async ({
    page,
  }) => {
    const uniqueHeading = `Published ${crypto.randomUUID()}`;

    await loginAs(page, "admin@demo.coolskool.test");
    await openHomePageEditor(page);

    const headingInput = page.locator("input").first();
    await headingInput.fill(uniqueHeading);
    await page.getByRole("button", { name: "Save as new version" }).click();
    await expect(page.getByText(/Saved as version/)).toBeVisible();

    const versionRow = page.getByRole("row").filter({ hasText: /^v\d+/ }).last();
    await versionRow.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("published").first()).toBeVisible();

    await page.goto(`/s/${SLUG}`);
    await expect(page.getByText(uniqueHeading)).toBeVisible();
  });

  test("an older, unpublished version opens read-only (no editor controls)", async ({ page }) => {
    await loginAs(page, "admin@demo.coolskool.test");
    await openHomePageEditor(page);

    const firstVersionLink = page.getByRole("link", { name: /^v1$/ });
    await firstVersionLink.click();
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("button", { name: "Save as new version" })).toHaveCount(0);
    await expect(page.getByText("Draft preview")).toBeVisible();
  });

  test("admissions (website.edit only) can save a draft but has no Publish control", async ({ page }) => {
    await loginAs(page, "admissions@demo.coolskool.test");
    await openHomePageEditor(page);

    const headingInput = page.locator("input").first();
    await headingInput.fill(`Admissions draft ${crypto.randomUUID()}`);
    await page.getByRole("button", { name: "Save as new version" }).click();
    await expect(page.getByText(/Saved as version/)).toBeVisible();

    await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  });

  test("clearing the hero heading shows a field error and disables Save (no version created)", async ({ page }) => {
    await loginAs(page, "admin@demo.coolskool.test");
    await openHomePageEditor(page);

    const headingInput = page.locator("input").first();
    await headingInput.fill("");

    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save as new version" })).toBeDisabled();
  });

  test("a notice created with 'Show on public site' checked appears on the public site once its publish date has passed", async ({
    page,
    request,
  }) => {
    const title = `PTM reminder ${crypto.randomUUID()}`;

    await loginAs(page, "admin@demo.coolskool.test");
    await page.goto(`/${SLUG}/website/notices`);
    await page.getByPlaceholder("Title").fill(title);
    await page.getByPlaceholder("Body").fill("Parent-teacher meeting this Friday.");
    await page.getByLabel("Show on public site").check();
    await page.getByRole("button", { name: "Save notice" }).click();
    await expect(page.getByText(title)).toBeVisible();

    const liveResponse = await request.get(`/s/${SLUG}`);
    expect(await liveResponse.text()).toContain(title);
  });
});
