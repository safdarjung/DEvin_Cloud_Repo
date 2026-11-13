import { expect, test } from "@playwright/test";
import { loginAs, SLUG } from "./fixtures";

// Phase 1 review flow: a teacher imports a draft, sends it for review; the exam controller approves it.
test("teacher imports a draft and submits it, controller approves it", async ({ page }) => {
  const body = `E2E review flow ${Date.now()}: which planet is closest to the Sun?`;
  const csv = `type,difficulty,body,answer,marks,options\nmcq,easy,"${body}",Mercury,1,Mercury|Venus|Earth|Mars\n`;

  await loginAs(page, "teacher.vi-a");
  await page.goto(`/${SLUG}/question-bank`);
  await page.getByRole("button", { name: "Import CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles({ name: "q.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByTestId("import-preview")).toContainText("all valid");
  await page.getByRole("button", { name: "Import", exact: true }).click();

  const row = page.getByTestId("question-row").filter({ hasText: body });
  await expect(row).toContainText("Draft");
  await row.getByRole("button", { name: "Submit for review" }).click();
  await expect(row).toContainText("In review");
  await expect(page.getByRole("tab", { name: /Review queue/ })).toHaveCount(0);

  await loginAs(page, "examcontroller");
  await page.goto(`/${SLUG}/question-bank`);
  await page.getByRole("tab", { name: /Review queue/ }).click();
  const queued = page.getByTestId("question-row").filter({ hasText: body });
  await queued.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("tab", { name: "Questions" }).click();
  await expect(page.getByTestId("question-row").filter({ hasText: body })).toContainText("Approved");
});
