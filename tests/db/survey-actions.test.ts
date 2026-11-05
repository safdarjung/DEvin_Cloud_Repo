// X08-T7 — survey.create / survey.close / survey.respond action tests.
// Mirrors tests/db/announcement-actions.test.ts (callAs + overrideCtx) and
// reuses tests/db/surveys-rls.test.ts's fixture shape (section audience via
// the createTestInstitution roster's own guardian/student).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { closeSurvey, createSurvey, respondToSurvey } from "@/modules/ptm/survey.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createEnrolment, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function futureIso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

async function studentIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select student_id from public.memberships where institution_id = ${institutionId} and role = 'student'`;
  return row.student_id as string;
}

async function guardianIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${institutionId} and role = 'guardian'`;
  return row.guardian_id as string;
}

/** Grade VI + section A; fixture roster's student enrolled + linked to the fixture guardian. */
async function makeSectionAudienceBase(inst: TestInstitution) {
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

describe("survey.create / survey.close / survey.respond (X08-T7)", () => {
  it("admin creates an open survey with a section audience; guardian responds, responding again is conflict", async () => {
    const inst = await createTestInstitution("survey-actions-flow");
    try {
      const base = await makeSectionAudienceBase(inst);

      const created = await callAs(inst, "admin", createSurvey, {
        title: "Term check-in",
        isAnonymous: false,
        closesAt: futureIso(3_600_000),
        questions: [{ type: "text", prompt: "Any feedback?" }],
        audiences: [{ type: "section", classSectionId: base.sectionA }],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const [row] = await sql`select status, opened_at from public.surveys where id = ${created.data.id}`;
      expect(row.status).toBe("open");
      expect(row.opened_at).not.toBeNull();

      const responded = await callAs(inst, "guardian", respondToSurvey, {
        surveyId: created.data.id,
        answers: ["All good"],
      });
      expect(responded.ok).toBe(true);

      const again = await callAs(inst, "guardian", respondToSurvey, {
        surveyId: created.data.id,
        answers: ["Once more"],
      });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe("conflict");

      const closed = await callAs(inst, "admin", closeSurvey, { surveyId: created.data.id });
      expect(closed.ok).toBe(true);
      if (closed.ok) expect(closed.data.id).toBe(created.data.id);
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("respond after close -> invalid_state", async () => {
    const inst = await createTestInstitution("survey-actions-closed");
    try {
      const base = await makeSectionAudienceBase(inst);

      const created = await callAs(inst, "admin", createSurvey, {
        title: "Closing soon",
        closesAt: futureIso(3_600_000),
        questions: [{ type: "text", prompt: "Thoughts?" }],
        audiences: [{ type: "section", classSectionId: base.sectionA }],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const closed = await callAs(inst, "admin", closeSurvey, { surveyId: created.data.id });
      expect(closed.ok).toBe(true);

      const responded = await callAs(inst, "guardian", respondToSurvey, {
        surveyId: created.data.id,
        answers: ["Too late"],
      });
      expect(responded.ok).toBe(false);
      if (!responded.ok) expect(responded.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("a grade of another institution is forbidden and leaves no draft", async () => {
    await withTwoInstitutions(async (a, b) => {
      const gradeOfB = await createGrade(b.institutionId);
      const result = await callAs(a, "admin", createSurvey, {
        title: "Cross-institution grade",
        closesAt: futureIso(3_600_000),
        questions: [{ type: "text", prompt: "Thoughts?" }],
        audiences: [{ type: "grade", gradeId: gradeOfB }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");

      const [row] = await sql`
        select count(*)::int as n from public.surveys
        where institution_id = ${a.institutionId} and title = 'Cross-institution grade'
      `;
      expect(row.n).toBe(0);
    });
  }, 30_000);

  it("a teacher is forbidden from creating a survey", async () => {
    const inst = await createTestInstitution("survey-actions-teacher-forbidden");
    try {
      const result = await callAs(inst, "teacher", createSurvey, {
        title: "Teacher attempt",
        closesAt: futureIso(3_600_000),
        questions: [{ type: "text", prompt: "Thoughts?" }],
        audiences: [{ type: "school" }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("a student is forbidden from responding to a survey", async () => {
    const inst = await createTestInstitution("survey-actions-student-forbidden");
    try {
      const result = await callAs(inst, "student", respondToSurvey, {
        surveyId: crypto.randomUUID(),
        answers: ["Hi"],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 30_000);
});
