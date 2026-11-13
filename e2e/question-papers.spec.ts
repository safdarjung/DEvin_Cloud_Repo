import { expect, test } from "@playwright/test";
import { loginAs, SLUG } from "./fixtures";

// Phase 3: a teacher builds a paper (wizard, fill, edit, submit); the exam controller approves, publishes and prints it.
// The AI gap-fill call is not exercised here (it needs a live model); drafts it saves would also block approval by design.
const SHOTS = process.env.E2E_SHOTS_DIR;
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

test("teacher builds and submits a paper; exam controller approves, publishes and prints", async ({ page, context }) => {
  test.setTimeout(240_000);
  const title = `E2E Paper ${Date.now()}`;

  // --- teacher: wizard ---
  await loginAs(page, "teacher.vi-a");
  await page.goto(`/${SLUG}/question-papers`);
  await expect(page.getByRole("heading", { name: "Question papers" })).toBeVisible();
  await page.getByRole("link", { name: "New paper" }).first().click();
  await expect(page.getByRole("heading", { name: "New question paper" })).toBeVisible();
  await shot(page, "01-wizard-step1");
  await page.getByRole("button", { name: "Next", exact: true }).click(); // source
  await page.getByRole("button", { name: "Next", exact: true }).click(); // blueprint
  await page.getByLabel("Title", { exact: true }).fill(title);
  // One section, one row: two 1-mark multiple-choice questions.
  await page.getByRole("button", { name: "Remove section" }).last().click();
  await page.getByRole("button", { name: "Remove section" }).last().click();
  await page.getByLabel("Section 1 row 1 count").fill("2");
  await page.getByLabel("Section 1 row 1 marks each").fill("1");
  await shot(page, "02-wizard-blueprint");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Create and fill paper" }).click();
  await expect(page.getByTestId("wizard-result")).toBeVisible({ timeout: 60_000 });
  await shot(page, "03-wizard-generate");
  await page.getByRole("link", { name: "Open the editor" }).click();

  // --- teacher: editor ---
  await expect(page.getByLabel("Paper title")).toHaveValue(title);
  await expect(page.getByTestId("paper-status")).toHaveText("Draft");
  // Header autosave.
  await page.getByLabel("Duration").fill("45");
  await expect(page.getByText("All changes saved")).toBeVisible();
  // Bring the paper to exactly two questions: remove what the bank filled, then write two.
  while ((await page.getByTestId("paper-item").count()) > 0) {
    await page.getByRole("button", { name: /^Remove question 1$/ }).click();
    await page.waitForTimeout(600);
  }
  for (const n of [1, 2]) {
    await page.getByRole("button", { name: "Write a question" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Question type").selectOption("mcq");
    await dialog.getByLabel("Marks", { exact: true }).fill("1");
    await dialog.getByLabel("Question text").fill(n === 1 ? "E2E which planet is closest to the sun?" : "E2E how many legs does a spider have in total?");
    await dialog.getByLabel("Option 1", { exact: true }).fill(n === 1 ? "Mercury" : "Eight");
    await dialog.getByLabel("Option 2", { exact: true }).fill(n === 1 ? "Venus" : "Six");
    await dialog.getByLabel("Option 1 is correct").check();
    await dialog.getByRole("button", { name: "Add to paper" }).click();
    await expect(page.getByTestId("paper-item")).toHaveCount(n);
  }
  await expect(page.getByTestId("validation")).toContainText("Ready to submit");
  await shot(page, "04-editor-ready");
  // Inline marks change breaks the total, then restore it.
  await page.getByLabel("Marks for question 1").fill("3");
  await page.getByLabel("Marks for question 1").blur();
  await expect(page.getByTestId("validation")).toContainText("problem");
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  await shot(page, "05-editor-invalid");
  await page.getByLabel("Marks for question 1").fill("1");
  await page.getByLabel("Marks for question 1").blur();
  await expect(page.getByTestId("validation")).toContainText("Ready to submit");
  // Move down, then OR-group both.
  await page.getByRole("button", { name: "Move question 1 down" }).click();
  await page.getByLabel("Select question 1 for OR grouping").check();
  await page.getByLabel("Select question 2 for OR grouping").check();
  await page.getByRole("button", { name: "Group selected as OR" }).click();
  await expect(page.getByText("OR", { exact: true })).toBeVisible();
  // OR-pair worth 1 mark: total is 1 of 2, so ungroup again to keep the paper valid.
  await page.getByLabel("Select question 1 for OR grouping").check();
  await page.getByLabel("Select question 2 for OR grouping").check();
  await page.getByRole("button", { name: "Ungroup selected" }).click();
  await expect(page.getByText("OR", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("validation")).toContainText("Ready to submit");
  const paperUrl = page.url();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByTestId("paper-status")).toHaveText("In review");
  await shot(page, "06-editor-in-review");
  const paperId = paperUrl.split("/").pop()!.split("?")[0];

  // --- exam controller: queue, approve, publish, print ---
  await loginAs(page, "examcontroller");
  await page.goto(`/${SLUG}/question-papers`);
  const queued = page.getByTestId("review-queue").getByText(title);
  await expect(queued).toBeVisible();
  await shot(page, "07-review-queue");
  await queued.click();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("paper-status")).toHaveText("Approved");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByTestId("paper-status")).toHaveText("Published");
  await expect(page.getByTestId("versions")).toContainText("Version");
  await shot(page, "08-published");

  for (const kind of ["paper", "key", "scheme"]) {
    const link = page.getByRole("link", { name: { paper: "Question paper", key: "Answer key", scheme: "Marking scheme" }[kind]!, exact: true });
    await expect(link).toHaveAttribute("href", new RegExp(`print\\?paper=${paperId}&kind=${kind}&set=A`));
    const res = await page.request.get(`/${SLUG}/question-papers/print?paper=${paperId}&kind=${kind}&set=B`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain(title);
    const popup = context.waitForEvent("page");
    await link.click();
    const tab = await popup;
    await tab.waitForLoadState();
    await expect(tab.locator("body")).toContainText(title);
    await shot(tab, `09-print-${kind}`);
    await tab.close();
  }
});

test("a student cannot open the paper builder", async ({ page }) => {
  await loginAs(page, "student.one");
  await page.goto(`/${SLUG}/question-papers`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Question papers" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "New paper" })).toHaveCount(0);
});
