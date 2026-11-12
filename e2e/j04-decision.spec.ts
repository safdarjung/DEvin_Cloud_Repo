import { createClient } from "@supabase/supabase-js";
import { expect, type Page, test } from "@playwright/test";

// J-04 (08 §4) — decision offer -> accept; decisions listed. Admissions seed
// (`APP-live-*`) is T-029 and not yet landed as of this packet, so this
// spec seeds its own `under_review` application directly via the
// service-role client (same "create the fixture the seed would otherwise
// provide" shape as j03's own-enquiry workaround) rather than depending on
// demo data that doesn't exist yet.
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const SLUG = "st-josephs-demo";

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

async function loginAs(page: Page, email: string) {
  await page.goto("/login?switch=1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.waitForLoadState("networkidle");
}

test.describe("J-04: application decision — offer then accept", () => {
  test("offer moves submitted-for-review to offered, accept moves it to accepted, both are listed as decisions", async ({ page }) => {
    const admin = serviceClient();
    const { data: institution, error: instError } = await admin
      .from("institutions")
      .select("id")
      .eq("slug", SLUG)
      .single();
    if (instError || !institution) throw instError ?? new Error("seeded demo institution not found");

    const { data: grade } = await admin.from("grades").select("id").eq("institution_id", institution.id).limit(1).single();
    const { data: year } = await admin.from("academic_years").select("id").eq("institution_id", institution.id).eq("is_current", true).limit(1).single();
    if (!grade || !year) throw new Error("seeded demo grade/academic year not found");

    const { data: application, error: appError } = await admin
      .from("applications")
      .insert({
        institution_id: institution.id,
        applicant: { firstName: "J04", lastName: "Candidate", dob: "2017-01-01", gender: "other" },
        guardian: { fullName: "J04 Guardian", phone: "9811112222", relationship: "father" },
        grade_applied_id: grade.id,
        academic_year_id: year.id,
        status: "under_review",
      })
      .select("id")
      .single();
    if (appError || !application) throw appError ?? new Error("fixture application was not created");

    await loginAs(page, "admissions@demo.coolskool.test");
    await page.goto(`/${SLUG}/admissions/applications/${application.id}`);
    await expect(page.getByText("Under review", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Offer", exact: true }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Offered", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Accepted", { exact: true })).toBeVisible();

    const decisions = page.locator("ul li", { hasText: /offer|accept/i });
    await expect(decisions).toHaveCount(2);
  });
});
