// X08-T3 — migration 0099 part B: surveys/survey_audiences/
// survey_respondents/survey_responses RLS, the guard (guard_surveys_write),
// and the three definers (my_open_surveys, submit_survey_response,
// survey_results). Mirrors tests/db/ptm-rls.test.ts's fixture shape
// (createTestInstitution + a second family for cross-section checks).
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createAcademicYear, createClassSection, createEnrolment, createGrade, closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function adminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

function futureIso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

async function signedInClient(email: string): Promise<SupabaseClient> {
  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

async function studentIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select student_id from public.memberships where institution_id = ${institutionId} and role = 'student'`;
  return row.student_id as string;
}

async function guardianIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${institutionId} and role = 'guardian'`;
  return row.guardian_id as string;
}

/** A second guardian+child family outside the fixture's one-per-role roster, with a real signed-in client. */
async function newFamily(
  institutionId: string,
  sectionId: string,
  academicYearId: string,
  fullName: string,
): Promise<{ guardianId: string; studentId: string; client: SupabaseClient }> {
  const email = `survey-rls-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await adminClient().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("test user was not created");

  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${institutionId}, ${fullName}, ${`9${String(Math.floor(100000000 + Math.random() * 900000000))}`})
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, guardian_id)
    values (${institutionId}, ${data.user.id}, 'guardian', ${guardian.id})
  `;
  const [student] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, ${fullName}, '2015-06-01', 'other')
    returning id
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${institutionId}, ${guardian.id}, ${student.id}, 'father', true, true)
  `;
  await createEnrolment(institutionId, student.id as string, sectionId, academicYearId, { status: "active" });

  return { guardianId: guardian.id as string, studentId: student.id as string, client: await signedInClient(email) };
}

/** Academic year + grade VI + sections A/B; fixture student enrolled + linked to fixture guardian, in section A. */
async function makeBase(inst: TestInstitution) {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VI" });
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
  const studentId = await studentIdFor(inst.institutionId);
  const guardianId = await guardianIdFor(inst.institutionId);
  await createEnrolment(inst.institutionId, studentId, sectionA, yearId, { status: "active" });
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
  return { yearId, gradeId, sectionA, sectionB, studentId, guardianId };
}

const singleQ = (prompt = "Pick one", options = ["Yes", "No"]) => ({ type: "single", prompt, options });
const multiQ = (prompt = "Pick some", options = ["A", "B", "C"]) => ({ type: "multi", prompt, options });
const textQ = (prompt = "Say something") => ({ type: "text", prompt });

function insertSurvey(
  inst: TestInstitution,
  overrides: Partial<{ title: string; questions: unknown[]; closesAt: string; isAnonymous: boolean }> = {},
) {
  return inst
    .clientAs("admin")
    .from("surveys")
    .insert({
      institution_id: inst.institutionId,
      title: overrides.title ?? "Parent check-in",
      is_anonymous: overrides.isAnonymous ?? true,
      questions: overrides.questions ?? [singleQ()],
      closes_at: overrides.closesAt ?? futureIso(3_600_000),
      created_by: inst.users.admin.id,
    })
    .select("id")
    .single();
}

async function createDraftSurvey(
  inst: TestInstitution,
  overrides: Partial<{ title: string; questions: unknown[]; closesAt: string; isAnonymous: boolean }> = {},
): Promise<string> {
  const { data, error } = await insertSurvey(inst, overrides);
  if (error) throw error;
  return data!.id as string;
}

function addAudience(
  inst: TestInstitution,
  surveyId: string,
  audience: Partial<{ audienceType: string; role: string; gradeId: string; classSectionId: string }>,
) {
  return inst.clientAs("admin").from("survey_audiences").insert({
    survey_id: surveyId,
    institution_id: inst.institutionId,
    audience_type: audience.audienceType,
    role: audience.role ?? null,
    grade_id: audience.gradeId ?? null,
    class_section_id: audience.classSectionId ?? null,
  });
}

function openSurvey(inst: TestInstitution, surveyId: string) {
  return inst.clientAs("admin").from("surveys").update({ status: "open" }).eq("id", surveyId).select("status").single();
}

function closeSurvey(inst: TestInstitution, surveyId: string) {
  return inst.clientAs("admin").from("surveys").update({ status: "closed" }).eq("id", surveyId).select("status").single();
}

describe("X08-T3: survey question-shape validation (guard_surveys_write insert)", () => {
  it("11 questions -> validation_failed", async () => {
    const inst = await createTestInstitution("survey-11q");
    try {
      const questions = Array.from({ length: 11 }, (_, i) => textQ(`Question ${i}`));
      const result = await insertSurvey(inst, { questions });
      expect(result.error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("single question with 1 option -> validation_failed", async () => {
    const inst = await createTestInstitution("survey-1opt");
    try {
      const result = await insertSurvey(inst, { questions: [singleQ("Pick one", ["Only one"])] });
      expect(result.error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("unknown question type -> validation_failed", async () => {
    const inst = await createTestInstitution("survey-badtype");
    try {
      const result = await insertSurvey(inst, { questions: [{ type: "yesno", prompt: "Pick one" }] });
      expect(result.error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});

describe("X08-T3: survey_audiences role check", () => {
  it("role audience 'student' -> 23514", async () => {
    const inst = await createTestInstitution("survey-roleaud");
    try {
      const surveyId = await createDraftSurvey(inst);
      const result = await addAudience(inst, surveyId, { audienceType: "role", role: "student" });
      expect(result.error?.code).toBe("23514");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});

describe("X08-T3: open surveys + recipients (my_open_surveys) + direct select denial", () => {
  it("section audience: that section's guardian sees it; another section's guardian and a student do not; guardian direct select on surveys -> empty", async () => {
    const inst = await createTestInstitution("survey-recipients");
    try {
      const base = await makeBase(inst);
      const surveyId = await createDraftSurvey(inst);
      const audience = await addAudience(inst, surveyId, { audienceType: "section", classSectionId: base.sectionA });
      expect(audience.error).toBeNull();
      const opened = await openSurvey(inst, surveyId);
      expect(opened.error).toBeNull();

      const otherFamily = await newFamily(inst.institutionId, base.sectionB, base.yearId, "Other Section Child");

      const mine = await inst.clientAs("guardian").rpc("my_open_surveys", { p_institution_id: inst.institutionId });
      expect(mine.error).toBeNull();
      expect((mine.data as Array<{ id: string }>).map((s) => s.id)).toContain(surveyId);

      const otherView = await otherFamily.client.rpc("my_open_surveys", { p_institution_id: inst.institutionId });
      expect(otherView.error).toBeNull();
      expect((otherView.data as Array<{ id: string }>).map((s) => s.id)).not.toContain(surveyId);

      const studentView = await inst.clientAs("student").rpc("my_open_surveys", { p_institution_id: inst.institutionId });
      expect(studentView.error).toBeNull();
      expect(studentView.data).toHaveLength(0);

      const directSelect = await inst.clientAs("guardian").from("surveys").select("id");
      expect(directSelect.data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});

describe("X08-T3: submit_survey_response lifecycle", () => {
  it("respond -> ok, again -> conflict; out-of-range/empty-multi/501-char/wrong-length -> validation_failed; non-recipient -> not_found", async () => {
    const inst = await createTestInstitution("survey-submit");
    try {
      const base = await makeBase(inst);
      const questions = [singleQ("Pick one", ["Yes", "No"]), multiQ("Pick some", ["A", "B", "C"]), textQ("Comments")];
      const surveyId = await createDraftSurvey(inst, { questions, isAnonymous: false });
      await addAudience(inst, surveyId, { audienceType: "section", classSectionId: base.sectionA });
      await openSurvey(inst, surveyId);

      const first = await inst.clientAs("guardian").rpc("submit_survey_response", {
        p_survey_id: surveyId,
        p_answers: [0, [0, 1], "Great"],
      });
      expect(first.error).toBeNull();

      const again = await inst.clientAs("guardian").rpc("submit_survey_response", {
        p_survey_id: surveyId,
        p_answers: [1, [0], "Again"],
      });
      expect(again.error?.message).toContain("code:conflict");

      const otherFamily = await newFamily(inst.institutionId, base.sectionB, base.yearId, "Non Recipient Child");
      const nonRecipient = await otherFamily.client.rpc("submit_survey_response", {
        p_survey_id: surveyId,
        p_answers: [0, [0], ""],
      });
      expect(nonRecipient.error?.message).toContain("code:not_found");

      const secondFamily = await newFamily(inst.institutionId, base.sectionA, base.yearId, "Second Family Child");

      const badIndex = await secondFamily.client.rpc("submit_survey_response", {
        p_survey_id: surveyId,
        p_answers: [5, [0], ""],
      });
      expect(badIndex.error?.message).toContain("code:validation_failed");

      const emptyMulti = await secondFamily.client.rpc("submit_survey_response", {
        p_survey_id: surveyId,
        p_answers: [0, [], ""],
      });
      expect(emptyMulti.error?.message).toContain("code:validation_failed");

      const longText = await secondFamily.client.rpc("submit_survey_response", {
        p_survey_id: surveyId,
        p_answers: [0, [0], "a".repeat(501)],
      });
      expect(longText.error?.message).toContain("code:validation_failed");

      const wrongLength = await secondFamily.client.rpc("submit_survey_response", {
        p_survey_id: surveyId,
        p_answers: [0, [0]],
      });
      expect(wrongLength.error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("closed survey -> invalid_state; lapsed closes_at -> invalid_state", async () => {
    const inst = await createTestInstitution("survey-closed");
    try {
      const base = await makeBase(inst);

      const closedSurveyId = await createDraftSurvey(inst, { closesAt: futureIso(3_600_000) });
      await addAudience(inst, closedSurveyId, { audienceType: "section", classSectionId: base.sectionA });
      await openSurvey(inst, closedSurveyId);
      const closed = await closeSurvey(inst, closedSurveyId);
      expect(closed.error).toBeNull();
      const closedSubmit = await inst.clientAs("guardian").rpc("submit_survey_response", {
        p_survey_id: closedSurveyId,
        p_answers: [0],
      });
      expect(closedSubmit.error?.message).toContain("code:invalid_state");

      const lapsedSurveyId = await createDraftSurvey(inst, { closesAt: futureIso(3_000) });
      await addAudience(inst, lapsedSurveyId, { audienceType: "section", classSectionId: base.sectionA });
      const lapsedOpen = await openSurvey(inst, lapsedSurveyId);
      expect(lapsedOpen.error).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 3_500));
      const lapsedSubmit = await inst.clientAs("guardian").rpc("submit_survey_response", {
        p_survey_id: lapsedSurveyId,
        p_answers: [0],
      });
      expect(lapsedSubmit.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});

describe("X08-T3: anonymous suppression + admin direct-select denial + midnight timestamp", () => {
  it("suppressed below 3 responses, counts shown at 3, responses hidden from direct select, stored created_at is midnight", async () => {
    const inst = await createTestInstitution("survey-anon");
    try {
      const surveyId = await createDraftSurvey(inst, { questions: [singleQ("Pick one", ["Yes", "No"])], isAnonymous: true });
      await addAudience(inst, surveyId, { audienceType: "school" });
      await openSurvey(inst, surveyId);

      await inst.clientAs("owner").rpc("submit_survey_response", { p_survey_id: surveyId, p_answers: [0] });
      await inst.clientAs("principal").rpc("submit_survey_response", { p_survey_id: surveyId, p_answers: [1] });

      const twoResponses = await inst.clientAs("admin").rpc("survey_results", { p_survey_id: surveyId });
      expect(twoResponses.error).toBeNull();
      expect((twoResponses.data as { suppressed: boolean }).suppressed).toBe(true);
      expect((twoResponses.data as { questions: unknown[] }).questions).toEqual([]);

      await inst.clientAs("admissions").rpc("submit_survey_response", { p_survey_id: surveyId, p_answers: [0] });

      const threeResponses = await inst.clientAs("admin").rpc("survey_results", { p_survey_id: surveyId });
      expect(threeResponses.error).toBeNull();
      const resultData = threeResponses.data as { suppressed: boolean; responseCount: number; questions: Array<{ options: Array<{ count: number }> }> };
      expect(resultData.suppressed).toBe(false);
      expect(resultData.responseCount).toBe(3);
      const counts = resultData.questions[0].options.reduce((sum, o) => sum + o.count, 0);
      expect(counts).toBe(3);

      const directSelect = await inst.clientAs("admin").from("survey_responses").select("id").eq("survey_id", surveyId);
      expect(directSelect.data).toHaveLength(0);

      const rows = await sql<{ created_at: Date }[]>`select created_at from public.survey_responses where survey_id = ${surveyId}`;
      for (const row of rows) {
        expect(row.created_at.getUTCHours()).toBe(0);
        expect(row.created_at.getUTCMinutes()).toBe(0);
        expect(row.created_at.getUTCSeconds()).toBe(0);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});

describe("X08-T3: non-anonymous results, forbidden, and status-transition guards", () => {
  it("non-anonymous results carry respondent names; teacher survey_results -> forbidden; edit after open -> invalid_state; audience insert after open -> rejected; closed->open -> invalid_state", async () => {
    const inst = await createTestInstitution("survey-nonanon");
    try {
      const base = await makeBase(inst);
      await sql`update public.profiles set full_name = 'Guardian Fixture' where id = ${inst.users.guardian.id}`;

      const surveyId = await createDraftSurvey(inst, { questions: [singleQ("Pick one", ["Yes", "No"])], isAnonymous: false });
      await addAudience(inst, surveyId, { audienceType: "section", classSectionId: base.sectionA });
      await openSurvey(inst, surveyId);

      const submit = await inst.clientAs("guardian").rpc("submit_survey_response", { p_survey_id: surveyId, p_answers: [0] });
      expect(submit.error).toBeNull();

      const results = await inst.clientAs("admin").rpc("survey_results", { p_survey_id: surveyId });
      expect(results.error).toBeNull();
      const resultData = results.data as { responses: Array<{ respondentName: string }> };
      expect(resultData.responses).toHaveLength(1);
      expect(resultData.responses[0].respondentName).toBe("Guardian Fixture");

      const directSelect = await inst.clientAs("admin").from("survey_responses").select("id").eq("survey_id", surveyId);
      expect(directSelect.data).toHaveLength(1);

      const teacherResults = await inst.clientAs("teacher").rpc("survey_results", { p_survey_id: surveyId });
      expect(teacherResults.error?.message).toContain("code:forbidden");

      const editAfterOpen = await inst.clientAs("admin").from("surveys").update({ questions: [textQ("Edited")] }).eq("id", surveyId);
      expect(editAfterOpen.error?.message).toContain("code:invalid_state");

      const audienceAfterOpen = await addAudience(inst, surveyId, { audienceType: "role", role: "teacher" });
      expect(audienceAfterOpen.error).not.toBeNull();

      const closed = await closeSurvey(inst, surveyId);
      expect(closed.error).toBeNull();
      const reopen = await openSurvey(inst, surveyId);
      expect(reopen.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});
