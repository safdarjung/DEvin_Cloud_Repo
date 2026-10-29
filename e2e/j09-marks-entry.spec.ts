import { expect, type Page, test } from "@playwright/test";

// J-09 (08 §4) — exam setup -> marks entry -> verification (06 §W7). Runs
// against the seeded demo tenant (`st-josephs-demo`), but builds its OWN
// exam through the UI rather than depending on T-021's seeded exam (still
// a stub, per packet assumption) — X-A/Mathematics (42 enrolled students,
// taught by teacher.x-a, per the academics seed) is real seeded data, the
// exam itself is created live by this spec.
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const SLUG = "st-josephs-demo";

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForLoadState("networkidle");
}

test.describe("J-09: exam setup, marks entry, verification", () => {
  test("examcontroller creates PT2-X (X-A Mathematics); teacher.x-a enters marks; verification lists missing then clean", async ({
    page,
  }) => {
    // 1. examcontroller creates the exam and one paper (X-A, Mathematics).
    await loginAs(page, "examcontroller@demo.coolskool.test");
    await page.goto(`/${SLUG}/exams/new`);
    // Unique per run — `exams` has a unique(term_id, name) constraint and this
    // spec reuses the seeded demo tenant/term across runs (no per-test fixture).
    const examName = `PT2-X (e2e ${Date.now()})`;
    await page.getByLabel("Exam name").fill(examName);
    await page.getByRole("button", { name: "Create exam" }).click();
    await page.waitForURL(/\/exams\/[0-9a-f-]+$/);
    const examId = new URL(page.url()).pathname.split("/").pop();

    const paperCheckbox = page.getByRole("checkbox", { name: "X-A Mathematics", exact: true });
    await expect(paperCheckbox).toBeVisible();
    await paperCheckbox.check();
    await page.getByRole("button", { name: /Create 1 paper/ }).click();
    await page.waitForURL(new RegExp(`/exams/${examId}$`));

    await expect(page.getByText("draft", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open marks entry" }).click();
    await expect(page.getByText("marks_entry", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: /X-A · Mathematics/ }).click();
    await page.waitForURL(/\/papers\/[0-9a-f-]+$/);
    const paperId = new URL(page.url()).pathname.split("/").pop();

    // 2. teacher.x-a enters marks for every X-A student EXCEPT one (42 enrolled, per the seed).
    await loginAs(page, "teacher.x-a@demo.coolskool.test");
    await page.goto(`/${SLUG}/exams/${examId}/papers/${paperId}`);
    const marksInputs = page.locator('input[type="number"]');
    const studentCount = await marksInputs.count();
    expect(studentCount).toBe(42);
    for (let i = 0; i < studentCount - 1; i++) {
      await marksInputs.nth(i).fill("70");
    }
    await page.getByRole("button", { name: /Save \d+ change/ }).click();
    await expect(page.getByText(`Saved — ${studentCount - 1} entered, 0 unchanged.`)).toBeVisible();

    // 3. examcontroller's verification panel lists the one missing student.
    await loginAs(page, "examcontroller@demo.coolskool.test");
    await page.goto(`/${SLUG}/exams/${examId}`);
    await page.getByRole("button", { name: "Check verification" }).click();
    await expect(page.getByText("1 missing, 0 out of range.")).toBeVisible();

    // 4. teacher.x-a enters the last student's mark.
    await loginAs(page, "teacher.x-a@demo.coolskool.test");
    await page.goto(`/${SLUG}/exams/${examId}/papers/${paperId}`);
    await marksInputs.last().fill("65");
    await page.getByRole("button", { name: /Save \d+ change/ }).click();
    await expect(page.getByText("Saved — 1 entered, 0 unchanged.")).toBeVisible();

    // 5. examcontroller re-checks: clean.
    await loginAs(page, "examcontroller@demo.coolskool.test");
    await page.goto(`/${SLUG}/exams/${examId}`);
    await page.getByRole("button", { name: "Check verification" }).click();
    await expect(page.getByText("Clean — every enrolled student has marks within range.")).toBeVisible();
  });
});
