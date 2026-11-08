import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
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

// Fixture row ids, populated during the test and torn down in afterAll —
// a direct Postgres connection (same shape as e2e/tenant-shell.spec.ts) is
// required because marks/results are guarded by app.marks_guard/
// results_guard, which only let DELETE through when `app.allow_reset` is
// set, a GUC PostgREST's admin client has no way to set.
const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 5 });
const fixture: {
  gradeId?: string;
  sectionId?: string;
  subjectId?: string;
  examId?: string;
  studentWithGuardianId?: string;
  studentOtherId?: string;
  guardianId?: string;
  guardianUserId?: string;
} = {};

test.describe("J-10: publish exam results, report card, guardian view", () => {
  test.afterAll(async () => {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.allow_reset', 'on', true)`;
      if (fixture.examId) {
        await tx`delete from public.results where exam_id = ${fixture.examId}`;
        await tx`delete from public.marks where exam_paper_id in (select id from public.exam_papers where exam_id = ${fixture.examId})`;
        await tx`delete from public.exam_papers where exam_id = ${fixture.examId}`;
        await tx`delete from public.exams where id = ${fixture.examId}`;
      }
      const studentIds = [fixture.studentWithGuardianId, fixture.studentOtherId].filter((id): id is string => Boolean(id));
      if (studentIds.length > 0) {
        await tx`delete from public.enrolments where student_id = any(${studentIds})`;
      }
      if (fixture.guardianId) await tx`delete from public.guardian_students where guardian_id = ${fixture.guardianId}`;
      if (fixture.guardianUserId) await tx`delete from public.memberships where user_id = ${fixture.guardianUserId}`;
      if (studentIds.length > 0) await tx`delete from public.students where id = any(${studentIds})`;
      if (fixture.guardianId) await tx`delete from public.guardians where id = ${fixture.guardianId}`;
      if (fixture.subjectId) await tx`delete from public.subjects where id = ${fixture.subjectId}`;
      if (fixture.sectionId) await tx`delete from public.class_sections where id = ${fixture.sectionId}`;
      if (fixture.gradeId) await tx`delete from public.grades where id = ${fixture.gradeId}`;
    });
    if (fixture.guardianUserId) {
      await serviceClient().auth.admin.deleteUser(fixture.guardianUserId);
    }
    await sql.end();
  });

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

    // Date.now() alone collides under parallel workers starting in the same
    // millisecond (observed: two specs' exam-paper checkboxes rendering the
    // identical aria-label). A short random component makes it unique.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: grade } = await admin
      .from("grades")
      .insert({ institution_id: institution.id, code: `J10-${suffix}`, display_name: "J-10 Test Grade", sort_key: 998, grade_group: "primary" })
      .select("id")
      .single();
    if (!grade) throw new Error("fixture grade was not created");
    fixture.gradeId = grade.id;

    const { data: section } = await admin
      .from("class_sections")
      .insert({ institution_id: institution.id, grade_id: grade.id, academic_year_id: year.id, name: "A" })
      .select("id")
      .single();
    // name must be unique too, not just code: PaperGrid's checkbox
    // aria-label is `${section.label} ${subject.name}` (no code/id), and
    // the seeded demo tenant already has a subject literally named
    // "Science" (scripts/seed/lib/subjects.ts) — plain "Science" here
    // collides with it in this fixture's own new section row, independent
    // of any other spec's concurrency.
    const subjectName = `Science ${suffix}`;
    const { data: subject } = await admin
      .from("subjects")
      .insert({ institution_id: institution.id, code: `J10SCI-${suffix}`, name: subjectName, kind: "scholastic" })
      .select("id")
      .single();
    if (!section || !subject) throw new Error("fixture section/subject were not created");
    fixture.sectionId = section.id;
    fixture.subjectId = subject.id;

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
    fixture.studentWithGuardianId = studentWithGuardian.id;
    fixture.studentOtherId = studentOther.id;

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
    fixture.guardianUserId = guardianAuth.user.id;

    // Unique per run — a hardcoded phone collides with
    // guardians(institution_id, phone)'s unique constraint on a rerun
    // against the same persistent demo tenant without an intervening
    // demo:reset.
    const guardianPhone = `9${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0")}`;
    const { data: guardian } = await admin
      .from("guardians")
      .insert({ institution_id: institution.id, full_name: "J10 Test Guardian", phone: guardianPhone })
      .select("id")
      .single();
    if (!guardian) throw new Error("fixture guardian was not created");
    fixture.guardianId = guardian.id;

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
    fixture.examId = examId;

    const paperCheckbox = page.getByRole("checkbox", { name: `J10-${suffix}-A ${subjectName}`, exact: true });
    await expect(paperCheckbox).toBeVisible();
    await paperCheckbox.check();
    await page.getByRole("button", { name: /Create 1 paper/ }).click();
    await page.waitForURL(new RegExp(`/exams/${examId}$`));

    await page.getByRole("button", { name: "Open marks entry" }).click();
    await expect(page.getByText("Marks entry", { exact: true }).first()).toBeVisible();

    const { data: examPaper } = await admin.from("exam_papers").select("id").eq("exam_id", examId).single();
    if (!examPaper) throw new Error("fixture exam paper was not created");
    await page.goto(`/${SLUG}/exams/${examId}/papers/${examPaper.id}`);

    // 2. enter marks for both students (examcontroller holds exam.marks.enter too).
    const marksInputs = page.locator('input[type="number"]');
    await expect(marksInputs).toHaveCount(2);
    // Root cause (Batch C) of the Save button going completely inert (no
    // network request, no console/page error, no DOM change): "92" exceeds
    // the input's native `max` (max_marks defaults to 80) — the browser
    // silently blocks the native form submission via HTML5 constraint
    // validation before it ever reaches React's submit handler. Was always
    // wrong here (pre-existing since this spec was written), just never
    // reached while the checkbox aria-label collision blocked the test
    // earlier in the flow.
    await marksInputs.nth(0).fill("70");
    await marksInputs.nth(1).fill("48");
    await page.getByRole("button", { name: /Save \d+ change/ }).click();
    await expect(page.getByText("Saved — 2 entered, 0 unchanged.")).toBeVisible();

    // 3. close marks entry, verify clean, publish.
    await page.goto(`/${SLUG}/exams/${examId}`);
    await page.getByRole("button", { name: "Close marks entry" }).click();
    await expect(page.getByText("Verification", { exact: true }).first()).toBeVisible();

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
