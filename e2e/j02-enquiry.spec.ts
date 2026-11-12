import { expect, test } from "@playwright/test";
import { resetEnquiryRateLimit } from "./fixtures";

// J-02 (08 §4) — submit the public enquiry form; reference shown; second
// submit with the same child/phone shows the duplicate message. Runs
// against the seeded demo tenant's admissions page.
const SLUG = "st-josephs-demo";

function uniquePhone(): string {
  // 10-digit Indian mobile starting 6-9 (app.submit_public_enquiry's
  // regex) — random per run so parallel/rerun test runs don't collide on
  // C-82's 24h dedupe window.
  const first = String(6 + Math.floor(Math.random() * 4));
  const rest = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  return first + rest;
}

async function fillAndSubmit(page: import("@playwright/test").Page, phone: string) {
  await page.goto(`/s/${SLUG}/admissions`);
  await page.getByLabel("Child's name").fill("Riya Verma");
  await page.getByLabel("Your name").fill("Sunita Verma");
  await page.getByPlaceholder("10-digit mobile number").fill(phone);
  await page.getByRole("button", { name: /submit enquiry/i }).click();
}

test.describe("J-02: public enquiry capture", () => {
  test.beforeEach(resetEnquiryRateLimit);

  test("submitting shows a reference, and the second identical submission shows the duplicate message", async ({
    page,
  }) => {
    const phone = uniquePhone();

    await fillAndSubmit(page, phone);
    await expect(page.getByRole("status")).toContainText(/reference ENQ-/i);

    await fillAndSubmit(page, phone);
    await expect(page.getByRole("status")).toContainText(/thank you/i);
    // 06 §W3: the duplicate response carries the same user-facing message
    // as a fresh submission — no distinct "already submitted" wording a
    // visitor could use to confirm an existing record.
  });

  test("a filled honeypot still shows the normal success message with no server error", async ({ page }) => {
    await page.goto(`/s/${SLUG}/admissions`);
    await page.getByLabel("Child's name").fill("Bot Child");
    await page.getByLabel("Your name").fill("Bot Guardian");
    await page.getByPlaceholder("10-digit mobile number").fill(uniquePhone());
    // The honeypot input is visually hidden but present in the DOM; a
    // scripted bot filling every field (unlike a sighted human) sets it.
    await page.locator('input[name="website"]').fill("http://spam.example", { force: true });
    await page.getByRole("button", { name: /submit enquiry/i }).click();
    await expect(page.getByRole("status")).toContainText(/thank you/i);
  });
});
