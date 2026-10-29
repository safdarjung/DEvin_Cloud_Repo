import { createClient } from "@supabase/supabase-js";
import { expect, type Page, test } from "@playwright/test";

// J-12 (08 §4) — controller reviews and decides a recheck request (06 §W8,
// T-020). Same fixture shape as e2e/j10-publish-results.spec.ts/
// e2e/j11-recheck-request.spec.ts; the "submitted" recheck request itself
// is seeded directly via the service-role client (service_role bypasses RLS
// natively, and app.guard_recheck_request_status only guards UPDATEs, so
// this INSERT is a legitimate shortcut for this spec, not a bypass of
// anything this packet is testing) — J-11 already covers the guardian's own
// request path end to end.
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
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

test.describe("J-12: controller reviews and decides a recheck request", () => {
  test("examcontroller starts review, approves with new marks; the report card and queue reflect the decision", async ({ page }) => {
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
      .insert({ institution_id: institution.id, code: `J12-${suffix}`, display_name: "J-12 Test Grade", sort_key: 996, grade_group: "primary" })
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
      .insert({ institution_id: institution.id, code: `J12SCI-${suffix}`, name: `Science J12 ${suffix}`, kind: "scholastic" })
      .select("id")
      .single();
    if (!section || !subject) throw new Error("fixture section/subject were not created");

    const { data: student } = await admin
      .from("students")
      .insert({ institution_id: institution.id, admission_no: `J12-${suffix}`, first_name: "Kabir", last_name: "J12", dob: "2015-01-01", gender: "male" })
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

    const guardianEmail = `j12-guardian-${suffix}@test.coolskool.test`;
    const { data: guardianAuth, error: guardianAuthError } = await admin.auth.admin.createUser({
      email: guardianEmail,
      password: "correct-horse-battery-staple",
      email_confirm: true,
    });
    if (guardianAuthError || !guardianAuth.user) throw guardianAuthError ?? new Error("failed to create guardian user");

    const { data: guardian } = await admin
      .from("guardians")
      .insert({ institution_id: institution.id, full_name: "J12 Test Guardian", phone: `9${String(suffix).slice(-9)}` })
      .select("id")
      .single();
    if (!guardian) throw new Error("fixture guardian was not created");

    await admin.from("guardian_students").insert({
      institution_id: institution.id,
      guardian_id: guardian.id,
      student_id: student.id,
      relationship: "father",
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
    const examName = `Unit Test J12 (e2e ${suffix})`;
    await page.getByLabel("Exam name").fill(examName);
    await page.getByRole("button", { name: "Create exam" }).click();
    await page.waitForURL(/\/exams\/[0-9a-f-]+$/);
    const examId = new URL(page.url()).pathname.split("/").pop();

    const paperCheckbox = page.getByRole("checkbox", { name: `J12-${suffix}-A Science J12 ${suffix}`, exact: true });
    await expect(paperCheckbox).toBeVisible();
    await paperCheckbox.check();
    await page.getByRole("button", { name: /Create 1 paper/ }).click();
    await page.waitForURL(new RegExp(`/exams/${examId}$`));

    await page.getByRole("button", { name: "Open marks entry" }).click();
    await expect(page.getByText("marks_entry", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(`J12-${suffix}`) }).click();
    await page.waitForURL(/\/papers\/[0-9a-f-]+$/);
    const paperUrl = page.url();
    const paperId = new URL(paperUrl).pathname.split("/").pop();

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

    const { data: result } = await admin
      .from("results")
      .select("id")
      .eq("institution_id", institution.id)
      .eq("exam_id", examId)
      .eq("student_id", student.id)
      .single();
    if (!result) throw new Error("fixture result was not published");

    const { data: request } = await admin
      .from("recheck_requests")
      .insert({
        institution_id: institution.id,
        result_id: result.id,
        exam_paper_id: paperId,
        requested_by: guardianAuth.user.id,
        reason: "The marking on this paper looks miscounted, please recheck.",
        status: "submitted",
      })
      .select("id")
      .single();
    if (!request) throw new Error("fixture recheck request was not created");

    // 2. examcontroller reviews the queue, starts review, approves with new marks.
    // The queue lists every request institution-wide, so a repeat run's
    // identically-named fixture student ("Kabir J12") isn't a unique
    // locator there — assert the queue shows at least one row for this
    // student, then navigate straight to this specific request by id.
    await loginAs(page, "examcontroller@demo.coolskool.test");
    await page.goto(`/${SLUG}/exams/rechecks`);
    await expect(page.getByRole("link", { name: "Kabir J12" }).first()).toBeVisible();
    await page.goto(`/${SLUG}/exams/rechecks/${request.id}`);

    await page.getByRole("button", { name: "Start review" }).click();
    await expect(page.getByRole("radio", { name: "Approve" })).toBeVisible();

    await page.getByRole("radio", { name: "Approve" }).check();
    await page.getByLabel(/New marks/).fill("75");
    await page.getByRole("button", { name: "Confirm approve" }).click();
    await expect(page.getByText("This request has already been decided.")).toBeVisible();

    // 3. the report card reflects the correction.
    await page.goto(`/${SLUG}/exams/${examId}/results`);
    await page.getByRole("link", { name: "Kabir J12" }).click();
    await page.waitForURL(/\/results\/[0-9a-f-]+$/);
    await expect(page.getByText("Corrected on", { exact: false })).toBeVisible();
    await expect(page.getByText("75").first()).toBeVisible();
  });
});
