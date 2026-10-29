import { createClient } from "@supabase/supabase-js";
import { expect, type Page, test } from "@playwright/test";

// J-10 (08 §4) — publish exam results -> report card -> guardian view (06
// §W7, T-019). Builds its OWN exam/section/students through the UI and a
// fresh guardian fixture via the service-role client, same shape as
// e2e/j09-marks-entry.spec.ts (own exam, seeded demo tenant) and
// e2e/j05-enrol.spec.ts (service-role fixture rows for anything the seed
// doesn't yet provide — T-021's Half-Yearly seed isn't landed as of this
// packet, per the packet's own stated assumption).
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

test.describe("J-10: publish exam results, report card, guardian view", () => {
  test("examcontroller publishes once verification is clean; guardian sees only their own linked child's report card", async ({
    page,
  }) => {
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
      .insert({ institution_id: institution.id, code: `J10-${suffix}`, display_name: "J-10 Test Grade", sort_key: 998, grade_group: "primary" })
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
      .insert({ institution_id: institution.id, code: `J10SCI-${suffix}`, name: "Science", kind: "scholastic" })
      .select("id")
      .single();
    if (!section || !subject) throw new Error("fixture section/subject were not created");

    // Two students: studentWithGuardian gets a fresh guardian (and its own
    // portal login) linked via guardian_students; studentOther has none —
    // the "another student's id" negative case.
    const { data: studentWithGuardian } = await admin
      .from("students")
      .insert({ institution_id: institution.id, admission_no: `J10-${suffix}-A`, first_name: "Asha", last_name: "J10", dob: "2015-01-01", gender: "female" })
      .select("id")
      .single();
    const { data: studentOther } = await admin
      .from("students")
      .insert({ institution_id: institution.id, admission_no: `J10-${suffix}-B`, first_name: "Vihaan", last_name: "J10", dob: "2015-02-01", gender: "male" })
      .select("id")
      .single();
    if (!studentWithGuardian || !studentOther) throw new Error("fixture students were not created");

    await admin.from("enrolments").insert([
      { institution_id: institution.id, student_id: studentWithGuardian.id, class_section_id: section.id, academic_year_id: year.id, started_on: "2026-04-01" },
      { institution_id: institution.id, student_id: studentOther.id, class_section_id: section.id, academic_year_id: year.id, started_on: "2026-04-01" },
    ]);

    const guardianEmail = `j10-guardian-${suffix}@test.coolskool.test`;
    const { data: guardianAuth, error: guardianAuthError } = await admin.auth.admin.createUser({
      email: guardianEmail,
      password: GUARDIAN_PASSWORD,
      email_confirm: true,
    });
    if (guardianAuthError || !guardianAuth.user) throw guardianAuthError ?? new Error("failed to create guardian user");

    const { data: guardian } = await admin
      .from("guardians")
      .insert({ institution_id: institution.id, full_name: "J10 Test Guardian", phone: "9800000700" })
      .select("id")
      .single();
    if (!guardian) throw new Error("fixture guardian was not created");

    await admin.from("guardian_students").insert({
      institution_id: institution.id,
      guardian_id: guardian.id,
      student_id: studentWithGuardian.id,
      relationship: "mother",
      is_primary: true,
    });
    await admin.from("memberships").insert({
      institution_id: institution.id,
      user_id: guardianAuth.user.id,
      role: "guardian",
      guardian_id: guardian.id,
    });

    // 1. examcontroller creates the exam + one paper for the fixture section/subject.
    await loginAs(page, "examcontroller@demo.coolskool.test");
    await page.goto(`/${SLUG}/exams/new`);
    const examName = `Half-Yearly J10 (e2e ${suffix})`;
    await page.getByLabel("Exam name").fill(examName);
    await page.getByRole("button", { name: "Create exam" }).click();
    await page.waitForURL(/\/exams\/[0-9a-f-]+$/);
    const examId = new URL(page.url()).pathname.split("/").pop();

    const paperCheckbox = page.getByRole("checkbox", { name: `J10-${suffix}-A Science`, exact: true });
    await expect(paperCheckbox).toBeVisible();
    await paperCheckbox.check();
    await page.getByRole("button", { name: /Create 1 paper/ }).click();
    await page.waitForURL(new RegExp(`/exams/${examId}$`));

    await page.getByRole("button", { name: "Open marks entry" }).click();
    await expect(page.getByText("marks_entry", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: new RegExp(`J10-${suffix}-A`) }).click();
    await page.waitForURL(/\/papers\/[0-9a-f-]+$/);

    // 2. enter marks for both students (examcontroller holds exam.marks.enter too).
    const marksInputs = page.locator('input[type="number"]');
    await expect(marksInputs).toHaveCount(2);
    await marksInputs.nth(0).fill("92");
    await marksInputs.nth(1).fill("48");
    await page.getByRole("button", { name: /Save \d+ change/ }).click();
    await expect(page.getByText("Saved — 2 entered, 0 unchanged.")).toBeVisible();

    // 3. close marks entry, verify clean, publish.
    await page.goto(`/${SLUG}/exams/${examId}`);
    await page.getByRole("button", { name: "Close marks entry" }).click();
    await expect(page.getByText("verification", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Publish / View results" }).click();
    await page.waitForURL(new RegExp(`/exams/${examId}/results$`));
    const publishTrigger = page.getByRole("button", { name: "Publish results" });
    await expect(publishTrigger).toBeEnabled();
    await publishTrigger.click();
    await expect(page.getByText("This cannot be undone; corrections are only possible via recheck.")).toBeVisible();
    await page.getByRole("button", { name: "Confirm publish" }).click();
    await page.waitForLoadState("networkidle");

    // 4. results list shows both students; report card link works for staff.
    await expect(page.getByRole("link", { name: "Asha J10" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Vihaan J10" })).toBeVisible();
    await page.getByRole("link", { name: "Asha J10" }).click();
    await page.waitForURL(/\/results\/[0-9a-f-]+$/);
    await expect(page.getByTestId("report-card")).toBeVisible();
    await expect(page.getByText("Science")).toBeVisible();
    const reportCardUrl = page.url();
    const studentWithGuardianId = new URL(reportCardUrl).pathname.split("/").pop();

    // 5. guardian sees their own linked child's report card at the same URL...
    await loginAs(page, guardianEmail, GUARDIAN_PASSWORD);
    await page.goto(reportCardUrl);
    await expect(page.getByTestId("report-card")).toBeVisible();

    // ...but a URL for the other (unrelated) student is not_found.
    const otherUrl = reportCardUrl.replace(studentWithGuardianId!, studentOther.id);
    const response = await page.goto(otherUrl);
    expect(response?.status()).toBe(404);
  });
});
