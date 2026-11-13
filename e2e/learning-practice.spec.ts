import { expect, test } from "@playwright/test";
import { loginAs, SLUG } from "./fixtures";

// Phase 5 (15-learning-exam-system-plan.md): student practises from the school bank, sees
// explained results and the weak-topics panel; a teacher sees section gaps; a guardian sees the child's read-only view.
const SHOTS = process.env.P5_SHOTS;
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p5-${name}.png`, fullPage: true });
};

test.describe("Learning & Practice (Phase 5)", () => {
  test("student practises from the bank, sees results, hub updates", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, "student.one");
    await page.goto(`/${SLUG}/portal/practice`);
    await expect(page.getByRole("heading", { name: "Learning & Practice" })).toBeVisible();
    await expect(page.getByText("Practice doesn't affect your marks").first()).toBeVisible();
    await shot(page, "student-hub");

    await page.getByRole("button", { name: "School questions" }).click();
    const start = page.getByRole("button", { name: /Start practice/ });
    if (!(await start.isVisible())) test.skip(true, "no approved bank questions for this student in the demo data");
    await start.click();
    await expect(page.getByText(/answered/).first()).toBeVisible();
    // Three rounds so a topic reaches the minimum question count for the weak-topics panel.
    for (let round = 0; round < 3; round++) {
      if (round > 0) await page.getByRole("button", { name: "Practice again" }).click();
      await expect(page.getByText(/answered/).first()).toBeVisible();
      for (const radio of await page.locator("fieldset input[type=radio]").all()) {
        const name = await radio.getAttribute("name");
        if (name && (await page.locator(`input[name="${name}"]:checked`).count()) === 0) await radio.check();
      }
      if (round === 0) await shot(page, "student-taking");
      await page.getByRole("button", { name: "Submit answers" }).click();
      await expect(page.getByTestId("bank-result")).toBeVisible();
    }
    await expect(page.getByText(/not your marks/)).toBeVisible();
    await shot(page, "student-result");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Progress over time" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where to focus" })).toBeVisible();
    await expect(page.getByTestId("weak-areas").or(page.getByText("No weak topics yet"))).toBeVisible();
    await page.locator(".recharts-surface").first().waitFor();
    await shot(page, "student-hub-after");
  });

  test("teacher sees section gaps and revision list", async ({ page }) => {
    await loginAs(page, "teacher.x-a");
    await page.goto(`/${SLUG}/learning-insights`);
    await expect(page.getByRole("heading", { name: "Learning insights" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where the class is weak" })).toBeVisible();
    await expect(page.getByTestId("section-gaps").or(page.getByText(/No chapters data yet/))).toBeVisible();
    await expect(page.getByRole("heading", { name: "Students needing revision" })).toBeVisible();
    await shot(page, "teacher-insights");
  });

  test("guardian sees the child's weak topics read-only", async ({ page }) => {
    test.setTimeout(90_000);
    await loginAs(page, "guardian.one");
    await page.goto(`/${SLUG}/portal/study-progress`);
    await expect(page.getByRole("heading", { name: "Weak topics from questions" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Practice now/ })).toHaveCount(0);
    await page.locator(".recharts-surface").first().waitFor();
    await shot(page, "guardian-progress");
  });
});
