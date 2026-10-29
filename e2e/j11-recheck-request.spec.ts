import { createClient } from "@supabase/supabase-js";
import { expect, type Page, test } from "@playwright/test";

// J-11 (08 §4) — guardian requests a recheck from the report card (06 §W8,
// T-020). Same fixture shape as e2e/j10-publish-results.spec.ts: a fresh
// grade/section/subject/student/guardian via the service-role client, then
// exam create -> marks entry -> publish through the UI as examcontroller,
// then the guardian's own recheck request through the portal.
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const GUARDIAN_PASSWORD = "correct-horse-battery-staple";
const SLUG = "st-josephs-demo";

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

async function loginAs(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForLoadState("networkidle");
}

test.describe("J-11: guardian requests a recheck", () => {
  test("guardian submits a recheck request for one paper; a second request for the same paper is blocked", async ({ page }) => {
    const admin = serviceClient();
    const { data: institution } = await admin.from("institutions").select("id").eq("slug", SLUG).single();
    if (!institution) throw new Error("seeded demo institution not found");

    const { data: year } = await admin
      .from("academic_years")
      .select("id")
      .eq("institution_id", institution.id)
      .eq("is_current", true)
      .single();
    if (!year) throw new Error("seeded demo academic year not found");

    const { data: term } = await admin
      .from("terms")
      .select("id")
      .eq("institution_id", institution.id)
      .eq("academic_year_id", year.id)
      .order("sequence", { ascending: true })
      .limit(1)
      .single();
    if (!term) throw new Error("seeded demo term not found");

    const suffix = Date.now();
    const { data: grade } = await admin
      .from("grades")
      .insert({ institution_id: institution.id, code: `J11-${suffix}`, display_name: "J-11 Test Grade", sort_key: 997, grade_group: "primary" })
      .select("id")
      .single();
    if (!grade) throw new Error("fixture grade was not created");

    const { data: section } = await admin
      .from("class_sections")
      .insert({ institution_id: institution.id, grade_id: grade.id, academic_year_id: year.id, name: "A" })
      .select("id")
      .single();
    const { data: subject } = await admin
      .from("subjects")
      .insert({ institution_id: institution.id, code: `J11SCI-${suffix}`, name: `Science J11 ${suffix}`, kind: "scholastic" })
      .select("id")
      .single();
    if (!section || !subject) throw new Error("fixture section/subject were not created");

    const { data: student } = await admin
      .from("students")
      .insert({ institution_id: institution.id, admission_no: `J11-${suffix}`, first_name: "Meera", last_name: "J11", dob: "2015-01-01", gender: "female" })
      .select("id")
      .single();
    if (!student) throw new Error("fixture student was not created");

    await admin.from("enrolments").insert({
      institution_id: institution.id,
      student_id: student.id,
      class_section_id: section.id,
      academic_year_id: year.id,
      started_on: "2026-04-01",
    });

    const guardianEmail = `j11-guardian-${suffix}@test.coolskool.test`;
    const { data: guardianAuth, error: guardianAuthError } = await admin.auth.admin.createUser({
      email: guardianEmail,
      password: GUARDIAN_PASSWORD,
      email_confirm: true,
    });
    if (guardianAuthError || !guardianAuth.user) throw guardianAuthError ?? new Error("failed to create guardian user");

    const { data: guardian } = await admin
      .from("guardians")
      .insert({ institution_id: institution.id, full_name: "J11 Test Guardian", phone: `9${String(suffix).slice(-9)}` })
      .select("id")
      .single();
    if (!guardian) throw new Error("fixture guardian was not created");

    await admin.from("guardian_students").insert({
      institution_id: institution.id,
      guardian_id: guardian.id,
      student_id: student.id,
      relationship: "mother",
      is_primary: true,
    });
    await admin.from("memberships").insert({
      institution_id: institution.id,
      user_id: guardianAuth.user.id,
      role: "guardian",
      guardian_id: guardian.id,
    });

    // 1. examcontroller creates the exam, one paper, enters marks, publishes.
    await loginAs(page, "examcontroller@demo.coolskool.test");
    await page.goto(`/${SLUG}/exams/new`);
    const examName = `Unit Test J11 (e2e ${suffix})`;
    await page.getByLabel("Exam name").fill(examName);
    await page.getByRole("button", { name: "Create exam" }).click();
    await page.waitForURL(/\/exams\/[0-9a-f-]+$/);
    const examId = new URL(page.url()).pathname.split("/").pop();

    const paperCheckbox = page.getByRole("checkbox", { name: `J11-${suffix}-A Science J11 ${suffix}`, exact: true });
    await expect(paperCheckbox).toBeVisible();
    await paperCheckbox.check();
    await page.getByRole("button", { name: /Create 1 paper/ }).click();
    await page.waitForURL(new RegExp(`/exams/${examId}$`));

    await page.getByRole("button", { name: "Open marks entry" }).click();
    await expect(page.getByText("marks_entry", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(`J11-${suffix}`) }).click();
    await page.waitForURL(/\/papers\/[0-9a-f-]+$/);

    await page.locator('input[type="number"]').first().fill("70");
    await page.getByRole("button", { name: /Save \d+ change/ }).click();
    await expect(page.getByText("Saved — 1 entered, 0 unchanged.")).toBeVisible();

    await page.goto(`/${SLUG}/exams/${examId}`);
    await page.getByRole("button", { name: "Close marks entry" }).click();
    await expect(page.getByText("verification", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Publish / View results" }).click();
    await page.waitForURL(new RegExp(`/exams/${examId}/results$`));
    await page.getByRole("button", { name: "Publish results" }).click();
    await page.getByRole("button", { name: "Confirm publish" }).click();
    await page.waitForLoadState("networkidle");

    // 2. guardian opens the portal, sees the report card, requests a recheck.
    await loginAs(page, guardianEmail, GUARDIAN_PASSWORD);
    await page.goto(`/${SLUG}/portal/results`);
    await expect(page.getByTestId("report-card")).toBeVisible();

    await page.getByRole("button", { name: "Request recheck" }).click();
    await page.getByLabel("Reason for recheck").fill("The total for this paper looks off by a few marks, please recheck.");
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByText("Recheck: submitted")).toBeVisible();

    // 3. a second request for the same paper is blocked (one open request —
    // the "Request recheck" button is gone, replaced by the status label).
    await expect(page.getByRole("button", { name: "Request recheck" })).toHaveCount(0);
  });
});
