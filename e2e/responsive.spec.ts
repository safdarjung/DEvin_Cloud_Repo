import { expect, type Page, test } from "@playwright/test";
import { loginAs, SLUG } from "./fixtures";

// 08 §5 responsive smoke — same five pages as a11y.spec.ts, at 390x844
// (mobile) and 1280x800 (desktop): no horizontal scroll, and the nav is
// reachable. Screenshots land in test-results/ (gitignored), same as every
// other Playwright artifact.
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

async function assertNoHorizontalScrollAndNav(page: Page, hasNav: boolean): Promise<void> {
  await page.waitForLoadState("networkidle");
  const hasHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalScroll).toBe(false);
  if (hasNav) await expect(page.locator("nav").first()).toBeVisible();
}

const PAGES: { name: string; hasNav: boolean; goto: (page: Page) => Promise<void> }[] = [
  // The pre-auth login form has no app nav — only the other four pages do.
  { name: "login", hasNav: false, goto: async (page) => { await page.goto("/login"); } },
  {
    name: "dashboard",
    hasNav: true,
    goto: async (page) => {
      await loginAs(page, "principal");
      await page.goto(`/${SLUG}/dashboard`);
    },
  },
  {
    name: "attendance",
    hasNav: true,
    goto: async (page) => {
      await loginAs(page, "teacher.vi-a");
      await page.goto(`/${SLUG}/attendance`);
    },
  },
  {
    name: "guardian-portal",
    hasNav: true,
    goto: async (page) => {
      await loginAs(page, "guardian.one");
      await page.goto(`/${SLUG}/portal`);
    },
  },
  { name: "public-home", hasNav: true, goto: async (page) => { await page.goto(`/s/${SLUG}`); } },
];

test.describe("Responsive smoke (390x844 and 1280x800)", () => {
  for (const { name, hasNav, goto } of PAGES) {
    for (const viewport of VIEWPORTS) {
      test(`${name} at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await goto(page);
        await assertNoHorizontalScrollAndNav(page, hasNav);
        await page.screenshot({ path: `test-results/responsive-${name}-${viewport.name}.png`, fullPage: true });
      });
    }
  }
});
