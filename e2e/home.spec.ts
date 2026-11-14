import { expect, test } from "@playwright/test";
import { HOME_STATS } from "../src/components/home/stats";
import { PROBLEMS } from "../src/components/home/story";
import { threadsMessage } from "../src/components/home/threads";
import { TOUR_ROLES } from "../src/components/tour/roles";

// "/": the landing page. Public, no login, no demo data needed. The copy is server-rendered, so these hold
// with or without the 3D tilt (it only changes how the hero's product screen stands).
test.describe("landing page", () => {
  test("states what the product is and answers every problem it lists", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Run the whole institution");
    await expect(page.getByRole("link", { name: "Book a demo" }).first()).toHaveAttribute("href", "/contact");
    await expect(page.getByRole("link", { name: "Try the live demo" }).first()).toHaveAttribute("href", "/demo");
    const tabs = page.getByRole("tablist", { name: "What institutions run on today" }).getByRole("tab");
    await expect(tabs).toHaveCount(PROBLEMS.length);
    for (const [i, p] of PROBLEMS.entries()) {
      await tabs.nth(i).click();
      await expect(page.locator("#platform-panel")).toContainText(p.pain);
      await expect(page.locator("#platform-panel")).toContainText(p.fix);
    }
  });

  test("a simulated answer carries its honesty label", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: /The receipt book/ }).click();
    await expect(page.locator("#platform-panel .fos-honest", { hasText: "Test mode only" })).toBeVisible();
  });

  test("the product tour has one step per recording and can jump between them", async ({ page }) => {
    await page.goto("/");
    const tour = page.locator("#see-fabricos");
    const steps = tour.getByRole("group", { name: "Tour steps" }).getByRole("button");
    await expect(steps).toHaveCount(5);
    await steps.nth(2).click();
    await expect(steps.nth(2)).toHaveAttribute("aria-current", "step");
    await expect(tour.locator("video")).toHaveAttribute("poster", /agents/);
  });

  test("each of the five people has a one-click demo form with the right account", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByRole("tablist", { name: "People" }).getByRole("tab");
    await expect(tabs).toHaveCount(TOUR_ROLES.length);
    for (const [i, role] of TOUR_ROLES.entries()) {
      await tabs.nth(i).click();
      const form = page.locator('#people-panel form[action="/api/public/demo-login"]');
      await expect(form.locator('input[name="email"]')).toHaveValue(role.demoEmail);
      await expect(form.getByRole("button", { name: `Try the ${role.label} demo` })).toBeVisible();
    }
  });

  test("the Orb section explains the assistant, and its ask demo gives a student hints before the answer", async ({ page }) => {
    await page.goto("/");
    const orb = page.locator("#orb");
    await expect(orb.getByRole("heading", { level: 2 })).toContainText("Meet the Orb");
    const demo = orb.locator(".lh-ask");
    await demo.scrollIntoViewIfNeeded();
    // Retried: a click that lands before hydration is not seen by React.
    await expect(async () => {
      await demo.getByRole("group", { name: "Ask as" }).getByRole("button", { name: "Student" }).click();
      await expect(demo.getByText("Hint 1.")).toBeVisible({ timeout: 2000 });
    }).toPass();
    await expect(demo.locator("[data-answer]")).toHaveCount(0);
    await demo.getByRole("button", { name: "Another hint" }).click();
    await demo.getByRole("button", { name: "Show the answer" }).click();
    await expect(demo.locator("[data-answer]")).toBeVisible();
  });

  test("the module switchboard lists every module, filters by search and labels what is not live", async ({ page }) => {
    await page.goto("/");
    const board = page.locator("#modules");
    await expect(board.getByRole("heading", { level: 2 })).toContainText(`${HOME_STATS.modules} modules`);
    await expect(board.locator("ul button")).toHaveCount(HOME_STATS.modules);
    // Retried: a fill that lands before hydration is not seen by React.
    await expect(async () => {
      await board.getByRole("searchbox").fill("");
      await board.getByRole("searchbox").fill("payroll");
      await expect(board.locator("ul button")).toHaveCount(1, { timeout: 1000 });
    }).toPass();
    await board.getByRole("searchbox").fill("");
    await board.getByRole("button", { name: "Online Payments" }).click();
    await expect(board.locator("[aria-live] .fos-honest")).toHaveText("Test mode only");
  });

  test("has no sideways scroll on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test("the contact form is prefilled from a thread choice", async ({ page }) => {
    await page.goto("/contact?threads=fees,not-a-thread");
    await expect(page.locator('textarea[name="message"]')).toHaveValue(threadsMessage("fees"));
  });
});
