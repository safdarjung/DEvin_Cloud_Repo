import { expect, test, type Page } from "@playwright/test";
import { loginAs, SLUG } from "./fixtures";

// Phase 4: teacher builds + publishes a paper (via the exam controller), sets it as an online test for X-A,
// a student takes it (reload mid-test resumes), the teacher marks the written answer and finalises, the
// controller publishes, the student sees the result and the teacher sees analytics.
// "Suggest with AI" needs a live model and "send to marks entry" needs an exam-linked paper: both are not exercised here.
const SHOTS = process.env.E2E_SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};
const local = (offsetMin: number) => {
  const d = new Date(Date.now() + offsetMin * 60_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

test("create, take, resume, submit, mark, publish and see the result", async ({ page }) => {
  test.setTimeout(360_000);
  const stamp = Date.now();
  const paperTitle = `E2E Test Paper ${stamp}`;
  const testTitle = `E2E Online ${stamp}`;

  // --- teacher: paper with one mcq (1) and one written question (2) ---
  await loginAs(page, "teacher.x-a");
  await page.goto(`/${SLUG}/question-papers/new`);
  // student.one sits in X-A, so the paper must be for grade X.
  const xValue = await page.locator("select[aria-label='Class and subject'] option", { hasText: /^X Mathematics/ }).first().getAttribute("value");
  await page.getByLabel("Class and subject").selectOption(xValue!);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(paperTitle);
  await page.getByRole("button", { name: "Remove section" }).last().click();
  await page.getByLabel("Section 1 row 1 count").fill("1");
  await page.getByLabel("Section 1 row 1 marks each").fill("1");
  await page.getByLabel("Section 2 row 1 count").fill("1");
  await page.getByLabel("Section 2 row 1 marks each").fill("2");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Create and fill paper" }).click();
  await expect(page.getByTestId("wizard-result")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Open the editor" }).click();
  await expect(page.getByLabel("Paper title")).toHaveValue(paperTitle);
  while ((await page.getByTestId("paper-item").count()) > 0) {
    await page.getByRole("button", { name: /^Remove question 1$/ }).click();
    await page.waitForTimeout(600);
  }
  await page.getByRole("button", { name: "Write a question" }).nth(0).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Question type").selectOption("mcq");
  await dialog.getByLabel("Marks", { exact: true }).fill("1");
  await dialog.getByLabel("Question text").fill("E2E which planet is closest to the sun?");
  await dialog.getByLabel("Option 1", { exact: true }).fill("Mercury");
  await dialog.getByLabel("Option 2", { exact: true }).fill("Venus");
  await dialog.getByLabel("Option 1 is correct").check();
  await dialog.getByRole("button", { name: "Add to paper" }).click();
  await expect(page.getByTestId("paper-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Write a question" }).nth(1).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Question type").selectOption("short_answer");
  await dialog.getByLabel("Marks", { exact: true }).fill("2");
  await dialog.getByLabel("Question text").fill("E2E explain why the sky is blue.");
  await dialog.getByLabel("Model answer").fill("Air scatters blue light more than red light (Rayleigh scattering).");
  await dialog.getByRole("button", { name: "Add to paper" }).click();
  await expect(page.getByTestId("paper-item")).toHaveCount(2);
  await expect(page.getByTestId("validation")).toContainText("Ready to submit");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByTestId("paper-status")).toHaveText("In review");

  // --- exam controller: approve + publish the paper ---
  await loginAs(page, "examcontroller");
  await page.goto(`/${SLUG}/question-papers`);
  await page.getByTestId("review-queue").getByText(paperTitle).click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("paper-status")).toHaveText("Approved");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByTestId("paper-status")).toHaveText("Published");

  // --- teacher: create + schedule the online test ---
  await loginAs(page, "teacher.x-a");
  await page.goto(`/${SLUG}/online-tests`);
  await expect(page.getByRole("heading", { name: "Online tests" })).toBeVisible();
  await shot(page, "p4-01-list");
  await page.getByRole("link", { name: "New test" }).first().click();
  const paperValue = await page.locator("select[aria-label='Question paper'] option", { hasText: paperTitle }).getAttribute("value");
  await page.getByLabel("Question paper").selectOption(paperValue!);
  await page.getByLabel("Title", { exact: true }).fill(testTitle);
  await page.getByRole("checkbox", { name: "Class X-A", exact: true }).check();
  await page.getByLabel("Opens at").fill(local(-2));
  await page.getByLabel("Closes at").fill(local(180));
  await page.getByLabel("Duration").fill("30");
  await shot(page, "p4-02-create");
  await page.getByRole("button", { name: "Create test" }).click();
  await expect(page.getByTestId("test-status")).toHaveText("Draft");
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByTestId("test-status")).not.toHaveText("Draft");
  await shot(page, "p4-03-scheduled");
  const detailUrl = page.url();

  // --- student: start, answer, reload (resume), submit ---
  await loginAs(page, "student.one");
  await page.goto(`/${SLUG}/portal/tests`);
  await expect(page.getByText(testTitle)).toBeVisible();
  await shot(page, "p4-04-my-tests");
  await page.getByTestId("my-test").filter({ hasText: testTitle }).getByRole("link", { name: /Open|Resume/ }).click();
  await shot(page, "p4-05-instructions");
  await page.getByTestId("start-test").click();
  await expect(page.getByTestId("runner-timer")).toBeVisible();
  await expect(page.getByTestId("question-body")).toBeVisible();
  const answerFirst = async () => {
    // Questions may be shuffled or ordered by section: answer whatever the current one is.
    const body = (await page.getByTestId("question-body").textContent()) ?? "";
    if (body.includes("planet")) await page.getByLabel("Option 1: Mercury").check();
    else await page.getByLabel("Your answer").fill("Blue light scatters more in air.");
    return body;
  };
  const q1 = await answerFirst();
  await expect(page.getByTestId("save-state")).toHaveText("All answers saved", { timeout: 15_000 });
  await page.getByTestId("flag-toggle").click();
  await expect(page.getByTestId("palette-q1")).toHaveAttribute("data-answered", "true");
  await shot(page, "p4-06-runner");
  const before = await page.getByTestId("runner-timer").getAttribute("aria-label");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await answerFirst();
  await expect(page.getByTestId("save-state")).toHaveText("All answers saved", { timeout: 15_000 });
  // Reload mid-test: same attempt, answers and (about) the same remaining time.
  await page.reload();
  await expect(page.getByTestId("runner-timer")).toBeVisible();
  const after = await page.getByTestId("runner-timer").getAttribute("aria-label");
  const secs = (l: string | null) => { const m = /(\d+):(\d+)$/.exec(l ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
  expect(secs(before) - secs(after)).toBeGreaterThanOrEqual(0);
  expect(secs(before) - secs(after)).toBeLessThan(40);
  await expect(page.getByTestId("palette-q1")).toHaveAttribute("data-answered", "true");
  await expect(page.getByTestId("palette-q2")).toHaveAttribute("data-answered", "true");
  expect(q1.length).toBeGreaterThan(0);
  await page.getByTestId("submit-button").click();
  await expect(page.getByTestId("submit-dialog")).toContainText("2 of 2 answered");
  await shot(page, "p4-07-submit-dialog");
  await page.getByTestId("submit-confirm").click();
  await expect(page.getByTestId("result-pending")).toBeVisible({ timeout: 30_000 });
  await shot(page, "p4-08-submitted");

  // --- teacher: monitor, mark, finalise ---
  await loginAs(page, "teacher.x-a");
  await page.goto(detailUrl);
  await expect(page.getByTestId("count-submitted_total")).toContainText("1");
  await shot(page, "p4-09-monitor");
  await page.getByRole("link", { name: "Marking" }).click();
  await expect(page.getByTestId("student-answer")).toContainText("Blue light");
  await expect(page.getByRole("button", { name: "Suggest with AI" })).toBeVisible();
  await page.getByLabel("Marks", { exact: true }).fill("1.5");
  await page.getByLabel("Feedback").fill("Good, name the scattering.");
  await page.getByRole("button", { name: "Save marks" }).click();
  await expect(page.getByText("Marked", { exact: true })).toBeVisible();
  await shot(page, "p4-10-marking");
  await page.getByRole("button", { name: "Finalise", exact: true }).first().click();
  await expect(page.getByTestId("queue-attempt")).toContainText("Evaluated");
  await page.goto(`${detailUrl}/analytics`);
  await expect(page.getByTestId("analytics")).toBeVisible();
  await expect(page.getByTestId("stat-average")).toContainText("2.5");
  await shot(page, "p4-11-analytics");

  // --- close (teacher) + publish (exam controller) ---
  await page.goto(detailUrl);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Close now" }).click();
  await expect(page.getByTestId("test-status")).toHaveText("Closed");
  await loginAs(page, "examcontroller");
  await page.goto(detailUrl);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Publish results" }).click();
  await expect(page.getByTestId("test-status")).toHaveText("Results published");
  await shot(page, "p4-12-published");

  // --- student result ---
  await loginAs(page, "student.one");
  await page.goto(`/${SLUG}/portal/tests`);
  await page.getByTestId("my-test").filter({ hasText: testTitle }).getByRole("link", { name: "See result" }).click();
  await expect(page.getByTestId("result-score")).toContainText("2.5 / 3");
  await expect(page.getByTestId("result-item")).toHaveCount(2);
  await shot(page, "p4-13-result");
});

test("a student cannot open the online test builder", async ({ page }) => {
  await loginAs(page, "student.one");
  await page.goto(`/${SLUG}/online-tests`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Online tests" })).toHaveCount(0);
});
