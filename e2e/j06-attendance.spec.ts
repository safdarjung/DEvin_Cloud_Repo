import { expect, type Page, test } from "@playwright/test";

// J-06 (08 §4) — attendance session -> submit -> absence notification. Runs
// against the seeded demo tenant (`st-josephs-demo`) rather than a
// self-contained fixture: the attendance seed (T-016) is still a stub
// (scripts/seed/sections/attendance.ts), so there is no pre-existing
// session for today — this spec exercises the first-time "open register,
// mark everyone, submit" path, not a pre-seeded one. The message-log
// assertion (confirming the in-app/SMS-simulated notification itself) is
// deferred to T-038's owner per the packet, once notifications/** lands.
//
// FOUND (seed data, not this packet): the academics seed assigns the
// "VI-A Class Teacher" staff row as `class_teacher_id` of TWO sections
// (I-A and VI-A), not just VI-A — confirmed by querying class_sections
// directly after `pnpm demo:reset`. AC1 ("teacher.vi-a sees only VI-A")
// is proved cleanly at the action layer in
// tests/db/attendance-actions.test.ts with an isolated fixture; this spec
// works around the seed bug by scoping to the VI-A row specifically
// rather than asserting there is exactly one row. Flagged for the
// academics-seed owner (T-011/seed), not fixed here (not this packet's file).
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const SLUG = "st-josephs-demo";

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForLoadState("networkidle");
}

test.describe("J-06: attendance marking and submission", () => {
  function viaRow(page: Page) {
    return page.getByRole("listitem").filter({ hasText: "VI-A" }).getByRole("link", { name: "Open register" });
  }

  test("teacher.vi-a sees VI-A under /attendance", async ({ page }) => {
    await loginAs(page, "teacher.vi-a@demo.coolskool.test");
    await page.goto(`/${SLUG}/attendance`);

    await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
    await expect(viaRow(page)).toHaveCount(1);
  });

  test("teacher.viii-b cannot open VI-A's register directly", async ({ page }) => {
    await loginAs(page, "teacher.vi-a@demo.coolskool.test");
    await page.goto(`/${SLUG}/attendance`);
    const href = await viaRow(page).getAttribute("href");
    expect(href).toBeTruthy();

    await loginAs(page, "teacher.viii-b@demo.coolskool.test");
    const response = await page.goto(`${new URL(href!, page.url()).pathname}${new URL(href!, page.url()).search}`);
    expect(response?.status()).toBe(404);
  });

  test("marking every student and submitting shows the absence/notification feedback", async ({ page }) => {
    await loginAs(page, "teacher.vi-a@demo.coolskool.test");
    await page.goto(`/${SLUG}/attendance`);
    await viaRow(page).click();
    await page.waitForLoadState("networkidle");

    const rows = page.getByRole("row");
    const rowCount = await rows.count();
    // Header row + at least one student row — a near-empty roster would
    // mean the academics/people seed didn't run, not that this flow is broken.
    expect(rowCount).toBeGreaterThan(1);

    const presentButtons = page.locator('[role="radiogroup"] button', { hasText: "P" });
    const presentCount = await presentButtons.count();
    for (let i = 0; i < presentCount; i++) {
      await presentButtons.nth(i).click();
    }

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Saved attendance for \d+ students\./)).toBeVisible();

    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText(/Attendance submitted — \d+ absences?, guardians notified \(SMS simulated\)\./)).toBeVisible();
  });
});
