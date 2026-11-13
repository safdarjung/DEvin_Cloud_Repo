import { expect, test } from "@playwright/test";
import { tinyPdf } from "../tests/helpers/tiny-pdf";
import { loginAs, SLUG } from "./fixtures";

// Phase 2: a school PDF is uploaded, marked school-owned, read, searched, and used for grounded question drafts.
// The AI generation call is mocked (visibly: the drafts say so); saving goes through the real createQuestion action.
test("upload, read, search a word, then save grounded drafts", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const title = `E2E Art Book ${stamp}`;
  const word = "quillwortzeta";
  const pdf = tinyPdf([
    ["Chapter 1 Colours", `The ${word} grows by the river and gives a green dye.`, "Mix blue and yellow to make green."],
    ["Mix red and white to make pink.", "Primary colours are red, yellow and blue."],
  ]);

  await loginAs(page, "principal");
  await page.goto(`/${SLUG}/textbooks`);
  const section = page.locator('[data-slot="card"]').first().locator("div.space-y-2").filter({ has: page.getByRole("heading", { name: "Art", exact: true }) }).first();
  await section.getByText("Add a book").click();
  await section.getByLabel("Title").fill(title);
  await section.getByLabel(/^PDF/).last().setInputFiles({ name: "art.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) });
  await section.getByRole("button", { name: "Add book", exact: true }).click();

  const book = page.getByTestId("book-row").filter({ hasText: title });
  await expect(book).toBeVisible({ timeout: 60_000 });
  await book.getByText("Edition and rights").click();
  await book.getByLabel(/^Rights:/).selectOption("school_owned");
  await book.getByRole("button", { name: "Save details" }).click();
  await expect(book.getByTestId("read-card")).toBeVisible({ timeout: 30_000 });

  await book.getByRole("button", { name: "Read this book" }).click();
  await expect(book.getByTestId("read-card")).toContainText("Done", { timeout: 60_000 });
  await expect(book.getByTestId("read-card")).toContainText("2 of 2 pages read");

  await page.goto(`/${SLUG}/textbooks/search?q=${word}`);
  const hit = page.getByTestId("search-hit").first();
  await expect(hit).toContainText("page 1", { timeout: 30_000 });
  await expect(hit.locator("mark")).toContainText(word);

  await page.route("**/api/ai/questions-generate", async (route) => {
    const req = route.request().postDataJSON() as { gradeId: string; subjectId: string; subjectTextbookId?: string };
    await route.fulfill({
      json: {
        ok: true,
        data: {
          grounded: true,
          note: null,
          sources: [{ label: "S1", chunkId: "c1", subjectTextbookId: req.subjectTextbookId ?? "", bookTitle: title, chapterNo: 1, pageFrom: 1, pageTo: 1 }],
          drafts: [{ type: "short_answer", subjectId: req.subjectId, gradeId: req.gradeId, difficulty: "medium", marks: 2, body: `[mocked AI ${stamp}] Which colours make green?`, answer: "Blue and yellow", origin: "ai", aiModel: "mock", sourcePage: 1, sourceSubjectTextbookId: req.subjectTextbookId ?? null }],
          dropped: 0,
          provider: "mock",
          model: "mock",
        },
      },
    });
  });
  await page.goto(`/${SLUG}/question-bank`);
  await page.getByRole("tab", { name: "From textbook" }).click();
  const panel = page.getByRole("tabpanel", { name: "From textbook" });
  await panel.getByRole("combobox", { name: "Grade and subject" }).click();
  await page.getByRole("option", { name: /^I · Art$/ }).click();
  await panel.getByRole("combobox", { name: "Book" }).click();
  await page.getByRole("option", { name: title }).click();
  await panel.getByRole("button", { name: "Generate drafts" }).click();
  await expect(page.getByTestId("generated")).toContainText("Grounded in your textbook");
  await expect(page.getByTestId("draft")).toContainText("Textbook page 1");
  await page.getByRole("button", { name: /^Save 1 selected/ }).click();
  await expect(page.getByTestId("draft")).toContainText("Saved as draft");

  await page.getByRole("tab", { name: /Review queue/ }).click();
  await expect(page.getByTestId("question-row").filter({ hasText: `[mocked AI ${stamp}]` })).toContainText("AI-written");
});
