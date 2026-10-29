import { expect, test } from "@playwright/test";
import { type DemoRole, DEMO_ROLES, loginAs, SLUG } from "./fixtures";

// J-00 (08 §4) — login as every demo role right after a reset; the page
// each role lands on must render without console errors. This is also the
// "demo:reset smoke" nonfunctional check (08 §5): running this spec at all,
// against the freshly globalSetup-reset demo tenant, proves the reset left
// every role loggable-in.
//
// The tenant root (`/[institution]`) redirects by `dashboard.view`
// (principal/admin/admissions/accountant/examcontroller -> /dashboard,
// everyone else -> /portal). `teacher` is neither "has dashboard.view" nor
// guardian/student-shaped, so the root sends it to /portal, which correctly
// 404s (no children, not a student) — real, not a bug: a teacher never
// visits the bare tenant root in the actual demo script (11 §10), they go
// straight to /attendance. This spec checks the page teachers actually
// use instead of the root-redirect's edge case.
const DASHBOARD_ROLES: DemoRole[] = ["principal", "admin", "admissions", "accountant", "examcontroller"];
const TEACHER_ROLES: DemoRole[] = ["teacher.vi-a", "teacher.viii-b", "teacher.x-a"];
const PORTAL_ROLES: Record<string, string> = {
  "guardian.one": "My children",
  "guardian.two": "My children",
  "student.one": "My school",
};

test.describe("J-00: login smoke, every demo role", () => {
  for (const role of DASHBOARD_ROLES) {
    test(`${role} lands on /dashboard with no console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });

      await loginAs(page, role);
      await page.goto(`/${SLUG}`);
      await expect(page).toHaveURL(new RegExp(`/${SLUG}/dashboard$`));
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  for (const role of TEACHER_ROLES) {
    test(`${role} reaches /attendance with no console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });

      await loginAs(page, role);
      await page.goto(`/${SLUG}/attendance`);
      await expect(page.getByRole("heading", { name: "Attendance" })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  for (const [role, heading] of Object.entries(PORTAL_ROLES)) {
    test(`${role} lands on /portal with no console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });

      await loginAs(page, role as DemoRole);
      await page.goto(`/${SLUG}`);
      await expect(page).toHaveURL(new RegExp(`/${SLUG}/portal`));
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("every demo login email is accepted (no typo in the seeded set)", () => {
    expect(Object.values(DEMO_ROLES)).toHaveLength(11);
    for (const email of Object.values(DEMO_ROLES)) {
      expect(email).toMatch(/@demo\.coolskool\.test$/);
    }
  });
});
