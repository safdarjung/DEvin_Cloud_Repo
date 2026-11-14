import { expect, test, type Page } from "@playwright/test";
import { TOUR_ROLES } from "../src/components/tour/roles";
import { SLIDES } from "../src/components/present/slide-meta";

// /product/deck: the founders' browser pitch deck. Public, no login, no demo data needed.
const current = (page: Page) => page.locator('section[aria-roledescription="slide"]:not([inert])');

test.describe("/product/deck", () => {
  test("loads on the title slide with no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/product/deck");
    await expect(page.getByRole("heading", { level: 1, name: "Fabric" })).toBeVisible();
    await expect(current(page)).toHaveAttribute("aria-label", `1 of ${SLIDES.length}: Fabric`);
    expect(errors).toEqual([]);
  });

  test("arrow keys change the slide and the URL hash", async ({ page }) => {
    await page.goto("/product/deck");
    await expect(current(page)).toHaveAttribute("aria-label", /^1 of /);

    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/#2$/);
    await expect(current(page)).toHaveAttribute("aria-label", /^2 of /);

    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(/#1$/);
    await expect(current(page)).toHaveAttribute("aria-label", /^1 of /);
  });

  test("the hash is restored on load", async ({ page }) => {
    await page.goto("/product/deck#3");
    await expect(current(page)).toHaveAttribute("aria-label", /^3 of /);
  });

  test("the last slide has a one-click demo form for every tour role", async ({ page }) => {
    await page.goto("/product/deck");
    // The key handler exists only after hydration: press until the deck answers.
    await expect(async () => {
      await page.keyboard.press("End");
      await expect(page).toHaveURL(new RegExp(`#${SLIDES.length}$`), { timeout: 1000 });
    }).toPass();

    const forms = current(page).locator('form[action="/api/public/demo-login"]');
    await expect(forms).toHaveCount(TOUR_ROLES.length);
    const emails = await forms.locator('input[name="email"]').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    expect(emails).toEqual(TOUR_ROLES.map((r) => r.demoEmail));
  });

  test("no horizontal overflow on a 390px phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/product/deck#5");
    await expect(current(page)).toHaveAttribute("aria-label", /^5 of /);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
