import { expect, type Page, test } from "@playwright/test";

// J-03 (08 §4) — admissions moves an enquiry through stages and converts it
// to an application. Admissions seed data (`ENQ-*`) is T-029 and not yet
// landed as of this packet, so this spec creates its own enquiry through
// the public form (T-024, same mechanism as j02-enquiry.spec.ts) rather
// than depending on a seeded row.
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const SLUG = "st-josephs-demo";

function uniquePhone(): string {
  const first = String(6 + Math.floor(Math.random() * 4));
  const rest = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  return first + rest;
}

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForLoadState("networkidle");
}

test.describe("J-03: admissions pipeline — move stages, convert to application", () => {
  test("a freshly submitted enquiry moves through stages and converts (AC1, AC2)", async ({ page }) => {
    const childName = `J03 Child ${crypto.randomUUID().slice(0, 8)}`;
    const phone = uniquePhone();

    await page.goto(`/s/${SLUG}/admissions`);
    await page.getByLabel("Child's name").fill(childName);
    await page.getByLabel("Your name").fill("J03 Guardian");
    await page.getByPlaceholder("10-digit mobile number").fill(phone);
    await page.getByRole("button", { name: /submit enquiry/i }).click();
    await expect(page.getByRole("status")).toContainText(/reference ENQ-/i);

    await loginAs(page, "admissions@demo.coolskool.test");
    await page.goto(`/${SLUG}/admissions`);
    await expect(page.getByRole("heading", { name: "Admissions pipeline" })).toBeVisible();

    // AC1: new -> contacted -> visit_scheduled, moved via the board's
    // select (packet: no drag-and-drop dependency).
    const card = page.getByRole("listitem").filter({ hasText: childName });
    await card.getByRole("combobox").click();
    await page.getByRole("option", { name: "Contacted", exact: true }).click();
    await page.waitForLoadState("networkidle");

    const movedCard = page.getByRole("listitem").filter({ hasText: childName });
    await movedCard.getByRole("combobox").click();
    await page.getByRole("option", { name: "Visit scheduled", exact: true }).click();
    await page.waitForLoadState("networkidle");

    // AC2: convert — open the detail page (its status badge confirms the
    // move landed; stages render humanized) and submit the convert form.
    await page.getByRole("link", { name: childName }).click();
    await expect(page.getByText("Visit scheduled", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Convert to application" }).click();
    await page.getByPlaceholder("First name").fill("Riya");
    await page.getByPlaceholder("Date of birth").fill("2018-05-01");
    await page.getByPlaceholder("Gender").fill("female");
    await page.getByPlaceholder("Guardian full name").fill("Sunita Verma");
    await page.getByPlaceholder("Guardian phone").fill(phone);
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    await page.waitForURL(/\/admissions\/applications\//);
    await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
  });
});
