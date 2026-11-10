import { expect, test, type Page } from "@playwright/test";
import { DEMO_ROLES } from "./fixtures";

const TOUR_EMAILS = [DEMO_ROLES.principal, DEMO_ROLES.admin, DEMO_ROLES["teacher.x-a"], DEMO_ROLES["student.one"], DEMO_ROLES["guardian.one"]];

async function expectTourBasics(page: Page) {
  await page.goto("/tour");
  await expect(page.getByRole("heading", { level: 1, name: "Walk through a school day" })).toBeVisible();

  const emails = page.locator('#main form[action="/api/public/demo-login"] input[name="email"]');
  await expect(emails).toHaveCount(5);
  expect(await emails.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))).toEqual(TOUR_EMAILS);

  // Keyboard path (works in both modes; in film mode the card is shown while focused).
  const show = page.getByRole("button", { name: /show features/i }).first();
  await expect(async () => {
    await show.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1000 });
  }).toPass();
}

test.describe("School tour", () => {
  test("3D film: five demo logins and Show features opens the explainer panel", async ({ page }) => {
    await expectTourBasics(page);
  });

  test.describe("reduced motion fallback", () => {
    test.use({ reducedMotion: "reduce" });

    test("static sections keep the same five demo logins and the features panel", async ({ page }) => {
      await expectTourBasics(page);
      await expect(page.locator(".tour-film")).toHaveCount(0);
    });
  });
});
