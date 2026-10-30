import { expect, test } from "@playwright/test";
import { DEMO_ROLES } from "./fixtures";

// Regression for a Server→Client Component boundary bug: a Lucide icon
// component was passed as a prop (a function isn't serializable across
// that boundary) and crashed every render of /login. Covers both that the
// page renders cleanly and that a tap actually signs in, no typing.
test.describe("One-click demo login buttons", () => {
  test("every demo account renders on /login with no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/login");

    // One <input type="hidden" name="email"> per account button — a direct
    // count against the fixtures list, not just a couple of spot checks.
    // (Scoped to hidden inputs: the manual LoginForm also has a visible,
    // valueless input[name="email"] that would otherwise collide here.)
    const emailInputs = await page.locator('input[type="hidden"][name="email"]').all();
    const renderedEmails = await Promise.all(emailInputs.map((el) => el.getAttribute("value")));
    expect(new Set(renderedEmails)).toEqual(new Set(Object.values(DEMO_ROLES)));

    expect(errors).toEqual([]);
  });

  test("tapping a demo account signs in with no typing", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /Principal/ }).click();
    await page.waitForURL(/\/dashboard$/);
    await expect(page.locator("body")).not.toContainText("Invalid email or password");
  });

  test("tapping a parent account lands on the portal", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /Priya Sharma/ }).click();
    await page.waitForURL(/\/portal$/);
  });
});
