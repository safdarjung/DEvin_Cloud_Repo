// X08-T8 — src/modules/ptm/survey.queries.ts (survey.list / survey.results /
// survey.mine), called directly as plain query functions (not via HTTP),
// mirrors tests/db/substitution-queries.test.ts's buildContext +
// setActingClient pattern. Reuses tests/db/surveys-rls.test.ts's
// insertSurvey/addAudience/openSurvey/makeBase fixture shape.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { surveyList, surveyMine, surveyResults } from "@/modules/ptm/survey.queries";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function futureIso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

const singleQ = (prompt = "Pick one", options = ["Yes", "No"]) => ({ type: "single", prompt, options });
const textQ = (prompt = "Comments") => ({ type: "text", prompt });

async function studentIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select student_id from public.memberships where institution_id = ${institutionId} and role = 'student'`;
  return row.student_id as string;
}

async function guardianIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${institutionId} and role = 'guardian'`;
  return row.guardian_id as string;
}

/** Academic year + grade VI + section A; fixture student enrolled + linked to fixture guardian, in section A (same shape as surveys-rls.test.ts's makeBase). */
async function makeBase(inst: TestInstitution) {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId, { code: "VI" });
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const studentId = await studentIdFor(inst.institutionId);
  const guardianId = await guardianIdFor(inst.institutionId);
  await createEnrolment(inst.institutionId, studentId, sectionA, yearId, { status: "active" });
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
  return { yearId, gradeId, sectionA, studentId, guardianId };
}

async function createOpenSurvey(
  inst: TestInstitution,
  sectionId: string,
  overrides: Partial<{ title: string; questions: unknown[]; isAnonymous: boolean; audienceType: "section" | "school" }> = {},
): Promise<string> {
  const { data, error } = await inst
    .clientAs("admin")
    .from("surveys")
    .insert({
      institution_id: inst.institutionId,
      title: overrides.title ?? "Parent check-in",
      is_anonymous: overrides.isAnonymous ?? true,
      questions: overrides.questions ?? [singleQ()],
      closes_at: futureIso(3_600_000),
      created_by: inst.users.admin.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  const surveyId = data!.id as string;

  const audienceType = overrides.audienceType ?? "section";
  const audience = await inst.clientAs("admin").from("survey_audiences").insert({
    survey_id: surveyId,
    institution_id: inst.institutionId,
    audience_type: audienceType,
    class_section_id: audienceType === "section" ? sectionId : null,
  });
  if (audience.error) throw audience.error;

  const opened = await inst.clientAs("admin").from("surveys").update({ status: "open" }).eq("id", surveyId);
  if (opened.error) throw opened.error;

  return surveyId;
}

describe("X08-T8: survey.list", () => {
  it("shows the open survey with its section audience", async () => {
    const inst = await createTestInstitution("survey-q-list");
    try {
      const base = await makeBase(inst);
      const surveyId = await createOpenSurvey(inst, base.sectionA, { title: "List Me" });

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const rows = await surveyList(ctx);
        const row = rows.find((r) => r.id === surveyId);
        expect(row).toMatchObject({ title: "List Me", status: "open", isAnonymous: true, questionCount: 1 });
        expect(row?.audiences).toEqual([{ type: "section", classSectionId: base.sectionA }]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});

describe("X08-T8: survey.results", () => {
  it("anonymous: suppressed below 3 responses, counted at 3 with sorted texts and no respondent field", async () => {
    const inst = await createTestInstitution("survey-q-anon");
    try {
      const base = await makeBase(inst);
      const surveyId = await createOpenSurvey(inst, base.sectionA, {
        questions: [singleQ("Pick one", ["Yes", "No"]), textQ("Comments")],
        isAnonymous: true,
        audienceType: "school",
      });

      const first = await inst.clientAs("owner").rpc("submit_survey_response", { p_survey_id: surveyId, p_answers: [0, "Zebra"] });
      expect(first.error).toBeNull();
      const second = await inst.clientAs("principal").rpc("submit_survey_response", { p_survey_id: surveyId, p_answers: [1, "Apple"] });
      expect(second.error).toBeNull();

      setActingClient(inst.clientAs("admin"));
      try {
        const suppressed = await surveyResults(surveyId);
        expect(suppressed.suppressed).toBe(true);
        expect(suppressed.questions).toEqual([]);
        expect(suppressed.responses).toBeUndefined();

        const third = await inst.clientAs("admissions").rpc("submit_survey_response", { p_survey_id: surveyId, p_answers: [0, "Mango"] });
        expect(third.error).toBeNull();

        const counted = await surveyResults(surveyId);
        expect(counted.suppressed).toBe(false);
        expect(counted.responseCount).toBe(3);
        expect(counted.responses).toBeUndefined();
        const textResult = counted.questions.find((q) => q.type === "text");
        expect(textResult?.texts).toEqual(["Apple", "Mango", "Zebra"]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("non-anonymous: results carry respondent names", async () => {
    const inst = await createTestInstitution("survey-q-nonanon");
    try {
      const base = await makeBase(inst);
      const surveyId = await createOpenSurvey(inst, base.sectionA, { isAnonymous: false });

      const submit = await inst.clientAs("guardian").rpc("submit_survey_response", { p_survey_id: surveyId, p_answers: [0] });
      expect(submit.error).toBeNull();

      setActingClient(inst.clientAs("admin"));
      try {
        const results = await surveyResults(surveyId);
        expect(results.responses).toHaveLength(1);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("guardian survey.results -> forbidden", async () => {
    const inst = await createTestInstitution("survey-q-forbidden");
    try {
      const base = await makeBase(inst);
      const surveyId = await createOpenSurvey(inst, base.sectionA);

      setActingClient(inst.clientAs("guardian"));
      try {
        await expect(surveyResults(surveyId)).rejects.toMatchObject({ code: "forbidden" });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});

describe("X08-T8: survey.mine", () => {
  it("shows responded after the guardian responds", async () => {
    const inst = await createTestInstitution("survey-q-mine");
    try {
      const base = await makeBase(inst);
      const surveyId = await createOpenSurvey(inst, base.sectionA);

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const before = await surveyMine(ctx);
        expect(before.find((s) => s.id === surveyId)?.responded).toBe(false);

        const submit = await inst.clientAs("guardian").rpc("submit_survey_response", { p_survey_id: surveyId, p_answers: [0] });
        expect(submit.error).toBeNull();

        const after = await surveyMine(ctx);
        expect(after.find((s) => s.id === surveyId)?.responded).toBe(true);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});
