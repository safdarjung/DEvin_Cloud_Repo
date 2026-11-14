import { expect, test } from "@playwright/test";
import { PROBLEMS, STORIES } from "../src/components/home/story";
import { threadsMessage } from "../src/components/home/threads";
import { TOUR_ROLES } from "../src/components/tour/roles";

// "/": the landing page. Public, no login, no demo data needed. The copy is server-rendered, so these hold
// with or without WebGL (the 3D film only changes how the first section is laid out).
test.describe("landing page", () => {
  test("states what the product is and lists every problem it answers", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("The whole school");
    const problems = page.getByRole("list", { name: "Seven loose threads a school runs on today" }).getByRole("listitem");
    await expect(problems).toHaveCount(PROBLEMS.length);
    // Scoped to the opening list: the threads picker further down repeats each pain.
    for (const p of PROBLEMS) await expect(problems.getByText(p.pain, { exact: true })).toBeAttached();
  });

  test("use cases switch by tab and show an honesty label on simulated steps", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByRole("tablist", { name: "Use cases" }).getByRole("tab");
    await expect(tabs).toHaveCount(STORIES.length);
    await tabs.nth(1).click();
    await expect(page.locator("#story-panel")).toContainText(STORIES[1].question);
    await expect(page.locator("#story-panel .lm-honest", { hasText: "Test mode only" })).toBeVisible();
  });

  test("each of the five people has a one-click demo form with the right account", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByRole("tablist", { name: "People" }).getByRole("tab");
    await expect(tabs).toHaveCount(TOUR_ROLES.length);
    for (const [i, role] of TOUR_ROLES.entries()) {
      await tabs.nth(i).click();
      const form = page.locator('#people-panel form[action="/api/public/demo-login"]');
      await expect(form.locator('input[name="email"]')).toHaveValue(role.demoEmail);
    }
  });

  test("links to the film, the 3D tour and the deck, and has no sideways scroll on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const finale = page.locator("#explore");
    await expect(finale.getByRole("link", { name: /Walk the 3D school/ })).toHaveAttribute("href", "/tour");
    await expect(finale.getByRole("link", { name: /Open the deck/ })).toHaveAttribute("href", "/product/deck");
    await expect(finale.getByRole("button", { name: /Watch the film/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test("ticking a loose thread lists its modules with their labels and carries the choice to the contact form", async ({ page }) => {
    await page.goto("/");
    const picker = page.locator("#threads");
    await picker.getByRole("button", { name: /The receipt book/ }).click();
    await expect(picker.locator(".lh-thread-mods")).toContainText("Online Payments");
    await expect(picker.locator(".lh-thread-mods .lm-honest", { hasText: "Test mode only" })).toBeVisible();
    const cta = picker.getByRole("link", { name: "Book a demo for this thread" });
    await expect(cta).toHaveAttribute("href", "/contact?threads=fees");
    await page.goto("/contact?threads=fees,not-a-thread");
    await expect(page.locator('textarea[name="message"]')).toHaveValue(threadsMessage("fees"));
  });

  test("the ask demo gives a student hints before the answer", async ({ page }) => {
    await page.goto("/");
    const demo = page.locator(".lh-ask");
    await demo.scrollIntoViewIfNeeded();
    await demo.getByRole("group", { name: "Ask as" }).getByRole("button", { name: "Student" }).click();
    await expect(demo.getByText("Hint 1.")).toBeVisible();
    await expect(demo.locator("[data-answer]")).toHaveCount(0);
    await demo.getByRole("button", { name: "Another hint" }).click();
    await demo.getByRole("button", { name: "Show the answer" }).click();
    await expect(demo.locator("[data-answer]")).toBeVisible();
    await expect(demo.locator(".lh-caption")).toContainText("sample data");
  });

  test("module search narrows the quilt and says so when nothing matches", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#modules");
    await section.getByRole("searchbox", { name: "Find a module" }).fill("payroll");
    await expect(section.locator(".lh-quilt li:not([data-hide])")).toHaveCount(1);
    await section.getByRole("searchbox", { name: "Find a module" }).fill("zzzz");
    await expect(section.getByRole("status")).toContainText("No module matches");
  });

  test("with reduced motion nothing is hidden waiting for an animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("#explore")).toBeAttached();
    await expect(page.locator(".lh")).not.toHaveAttribute("data-motion", "on");
    const hidden = await page.evaluate(() => [...document.querySelectorAll("[data-reveal]")].filter((el) => getComputedStyle(el).opacity === "0").length);
    expect(hidden).toBe(0);
  });
});
