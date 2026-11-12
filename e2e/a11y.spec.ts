import { expect, type Page, test } from "@playwright/test";
import { loginAs, SLUG } from "./fixtures";

// 08 §5 accessibility smoke, on the five pages the packet names: login,
// dashboard, attendance, guardian portal, public home. The packet's
// acceptance criterion asks for @axe-core/playwright with zero serious/
// critical violations — this run was told "no new deps", and axe-core
// itself is only a transitive dependency (not hoisted, not importable
// without adding @axe-core/playwright as a direct devDependency), so this
// spec is a hand-rolled substitute covering the checks axe would flag most
// often (missing alt text, unnamed interactive controls, no landmark).
// FOLLOW-UP: swap this for @axe-core/playwright once a new-dep run is
// approved — tracked in the completion report, not silently dropped.
async function assertBasicA11y(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");

  const unnamedImages = await page.locator("img").evaluateAll((imgs) =>
    imgs.filter((img) => !img.hasAttribute("alt")).map((img) => img.outerHTML.slice(0, 120)),
  );
  expect(unnamedImages, "every <img> must have an alt attribute (empty alt is fine for decorative images)").toEqual([]);

  const unnamedControls = await page
    .locator("button, a[href], input:not([type=hidden]), select, textarea")
    .evaluateAll((els) =>
      els
        .filter((el) => el.getAttribute("aria-hidden") !== "true")
        .filter((el) => {
          const label =
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            el.getAttribute("placeholder") ||
            (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
            el.textContent?.trim() ||
            (el instanceof HTMLInputElement ? el.value : "");
          return !label;
        })
        .map((el) => el.outerHTML.slice(0, 160)),
    );
  expect(unnamedControls, "every interactive control must have an accessible name").toEqual([]);

  await expect(page.locator("main, [role='main']")).not.toHaveCount(0);
}

test.describe("Accessibility smoke (hand-rolled substitute for axe-core — see note above)", () => {
  test("login page", async ({ page }) => {
    await page.goto("/login?switch=1");
    await assertBasicA11y(page);
  });

  test("dashboard (principal)", async ({ page }) => {
    await loginAs(page, "principal");
    await page.goto(`/${SLUG}/dashboard`);
    await assertBasicA11y(page);
  });

  test("attendance (teacher.vi-a)", async ({ page }) => {
    await loginAs(page, "teacher.vi-a");
    await page.goto(`/${SLUG}/attendance`);
    await assertBasicA11y(page);
  });

  test("guardian portal (guardian.one)", async ({ page }) => {
    await loginAs(page, "guardian.one");
    await page.goto(`/${SLUG}/portal`);
    await assertBasicA11y(page);
  });

  test("public home", async ({ page }) => {
    await page.goto(`/s/${SLUG}`);
    await assertBasicA11y(page);
  });
});
