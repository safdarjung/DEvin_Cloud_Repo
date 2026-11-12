import { expect, test } from "@playwright/test";

// J-01 (08 §4) — visit the public site, read pages/notices/events, confirm
// draft text never leaks. Runs against the seeded demo tenant
// (`scripts/seed/sections/website.ts`), not an isolated fixture: the
// public renderer has no session to scope a fixture to, so the demo
// tenant's own `st-josephs-demo` site is the fixture (same pattern as
// e2e/j06-attendance.spec.ts).
const SLUG = "st-josephs-demo";

// Mirrors `DRAFT_ONLY_MARKER` in scripts/seed/sections/website.ts (not
// imported across the scripts/e2e boundary — this spec isn't run in
// phase 1, so the string is duplicated here rather than left unverified).
const DRAFT_ONLY_MARKER = "DRAFT-ONLY-MARKER-never-published-2026";

test.describe("J-01: public site renders published content only", () => {
  test("home page renders with seeded content", async ({ page }) => {
    const response = await page.goto(`/s/${SLUG}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("3,024")).toBeVisible(); // stats block, student count
  });

  test("admissions page renders", async ({ page }) => {
    const response = await page.goto(`/s/${SLUG}/admissions`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("button", { name: /submit enquiry/i })).toBeVisible();
  });

  test("about and contact pages render", async ({ page }) => {
    expect((await page.goto(`/s/${SLUG}/about`))?.status()).toBe(200);
    expect((await page.goto(`/s/${SLUG}/contact`))?.status()).toBe(200);
  });

  test("unknown slug returns 404", async ({ page }) => {
    const response = await page.goto("/s/no-such-school-at-all");
    expect(response?.status()).toBe(404);
  });

  test("unknown path on a known slug shows the not-found page", async ({ page }) => {
    // Status is 200, not 404: /s/[slug]/loading.tsx commits the status before notFound() (same cause as DBT-83).
    await page.goto(`/s/${SLUG}/no-such-page`);
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(page.getByRole("button", { name: /submit enquiry/i })).toHaveCount(0);
  });

  test("C-80: draft v2 text never appears on the published home page", async ({ page }) => {
    await page.goto(`/s/${SLUG}`);
    await expect(page.getByText(DRAFT_ONLY_MARKER)).toHaveCount(0);
  });

  test("no console errors on the home page", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto(`/s/${SLUG}`);
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("renders without horizontal scroll at mobile viewport width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/s/${SLUG}`);
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalScroll).toBe(false);
  });
});
