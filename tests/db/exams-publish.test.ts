import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { closeMarksEntry, createExam, createExamPapers, enterMarks, openMarksEntry, publishExamResults } from "@/modules/exams/actions";
import { DEFAULT_GRADING_BANDS, gradeFor } from "@/modules/exams/grade";
import { getCurrentResult, listResultsForExam } from "@/modules/exams/queries";
import type { Database } from "@/lib/db/types";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

/** The full nine-band "default" grading scale (05 §4.1, same bands tests/db/foundation.test.ts seeds). */
async function setExamSettings(institutionId: string): Promise<void> {
  const patch = {
    locale: { timezone: "Asia/Kolkata", currency: "INR" },
    exams: { pass_percentage: 33, grading_scales: { default: DEFAULT_GRADING_BANDS } },
  };
  // postgres.js's JSONValue type doesn't accept a concrete array-typed
  // property (GradingBand[]) nested inside an object literal; the shape is
  // still plain JSON at runtime, so the cast is purely to satisfy that type.
  await sql`
    update public.institutions
    set settings = settings || ${sql.json(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      patch as any,
    )}
    where id = ${institutionId}
  `;
}

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2014-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

async function examStatus(examId: string): Promise<string> {
  const [row] = await sql`select status from public.exams where id = ${examId}`;
  return row.status as string;
}

/**
 * One section, two subjects, a teacher assigned to both, a term, and two
 * enrolled students: `studentA` is the fixture's own "student"/"guardian"
 * roles (linked via guardian_students, so RLS-scoped portal checks have a
 * real guardian to test), `studentB` is a freestanding student with no
 * guardian link at all (the "another student" negative case).
 */
async function setupFixture(institutionId: string, teacherId: string, studentUserId: string, guardianUserId: string) {
  await setExamSettings(institutionId);
  const yearId = await createAcademicYear(institutionId);
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId);
  const sectionId = await createClassSection(institutionId, gradeId, yearId);
  const mathId = await createSubject(institutionId, { code: "MATH", name: "Mathematics" });
  const englishId = await createSubject(institutionId, { code: "ENG", name: "English" });
  await createSubjectAssignment(institutionId, sectionId, mathId, teacherId);
  await createSubjectAssignment(institutionId, sectionId, englishId, teacherId);

  const [studentAMembership] = await sql`
    select student_id from public.memberships where institution_id = ${institutionId} and user_id = ${studentUserId}
  `;
  const studentA = studentAMembership.student_id as string;

  const [guardianMembership] = await sql`
    select guardian_id from public.memberships where institution_id = ${institutionId} and user_id = ${guardianUserId}
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${institutionId}, ${guardianMembership.guardian_id}, ${studentA}, 'father', true)
  `;

  const studentB = await insertStudent(institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);

  await createEnrolment(institutionId, studentA, sectionId, yearId);
  await createEnrolment(institutionId, studentB, sectionId, yearId);

  return { yearId, termId, gradeId, sectionId, mathId, englishId, studentA, studentB };
}

describe("exams module (T-019) — publishExamResults, report cards, grade parity", () => {
  it("AC1/AC2: publish sets exams.status=published, one results row per enrolled student, one notify.results_published job per result; publishing is blocked until verification is clean", async () => {
    const inst = await createTestInstitution("exams-publish");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { termId, sectionId, mathId, englishId, studentA, studentB } = await setupFixture(
        inst.institutionId,
        teacherId,
        inst.users.student.id,
        inst.users.guardian.id,
      );

      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "Half-Yearly (publish test)", type: "half_yearly" });
      if (!created.ok) throw new Error("setup failed");
      const examId = created.data.id;

      const papers = await callAs(inst, "exam_controller", createExamPapers, {
        examId,
        papers: [
          { classSectionId: sectionId, subjectId: mathId, maxMarks: 100, passMarks: 33 },
          { classSectionId: sectionId, subjectId: englishId, maxMarks: 100, passMarks: 33 },
        ],
      });
      if (!papers.ok) throw new Error("setup failed");
      const paperRows = await sql`select id, subject_id from public.exam_papers where exam_id = ${examId}`;
      const mathPaper = (paperRows.find((p) => p.subject_id === mathId) as { id: string }).id;
      const englishPaper = (paperRows.find((p) => p.subject_id === englishId) as { id: string }).id;

      await callAs(inst, "exam_controller", openMarksEntry, { examId });

      // AC2: publishing is blocked (invalid_state) while the exam isn't in
      // `verification` yet — the action forwards straight to app.publish_exam_results,
      // which is the real enforcement, not the UI's disabled button.
      const tooEarly = await callAs(inst, "exam_controller", publishExamResults, { examId });
      expect(tooEarly).toMatchObject({ ok: false, error: { code: "invalid_state" } });

      await callAs(inst, "teacher", enterMarks, {
        examPaperId: mathPaper,
        marks: [
          { studentId: studentA, marksObtained: 95, isAbsent: false },
          { studentId: studentB, marksObtained: 35, isAbsent: false },
        ],
      });

      // Only one of the two papers has marks — close marks entry and try to
      // publish: AC2's "missing students" case must also be invalid_state.
      await callAs(inst, "exam_controller", closeMarksEntry, { examId });
      const missingStillOpen = await callAs(inst, "exam_controller", publishExamResults, { examId });
      expect(missingStillOpen).toMatchObject({ ok: false, error: { code: "invalid_state" } });

      // A teacher never holds exam.result.publish (07 §2.2) — forbidden, not invalid_state.
      const teacherForbidden = await callAs(inst, "teacher", publishExamResults, { examId });
      expect(teacherForbidden).toMatchObject({ ok: false, error: { code: "forbidden" } });

      // Reopen, finish entering the English paper, re-close, then publish clean.
      await sql`update public.exams set status = 'marks_entry' where id = ${examId}`;
      await callAs(inst, "teacher", enterMarks, {
        examPaperId: englishPaper,
        marks: [
          { studentId: studentA, marksObtained: 85, isAbsent: false },
          { studentId: studentB, isAbsent: true },
        ],
      });
      await sql`update public.exams set status = 'verification' where id = ${examId}`;

      const published = await callAs(inst, "exam_controller", publishExamResults, { examId });
      expect(published).toMatchObject({ ok: true, data: { result_count: 2 } });
      expect(await examStatus(examId)).toBe("published");

      const resultRows = await sql`
        select id, student_id, version_no, superseded_by, percentage, grade
        from public.results where exam_id = ${examId} order by student_id
      `;
      expect(resultRows).toHaveLength(2);
      for (const row of resultRows) {
        expect(row.version_no).toBe(1);
        expect(row.superseded_by).toBeNull();
      }

      // AC1 (C-41): one notify.results_published job per published result,
      // idempotency key `result:<id>`.
      const jobs = await sql`
        select idempotency_key, payload from public.jobs
        where institution_id = ${inst.institutionId}::uuid and type = 'notify.results_published'
      `;
      expect(jobs).toHaveLength(2);
      const jobResultIds = jobs.map((j) => (j.payload as { result_id: string }).result_id).sort();
      expect(jobResultIds).toEqual(resultRows.map((r) => r.id).sort());
      for (const job of jobs) {
        expect(job.idempotency_key).toBe(`result:${(job.payload as { result_id: string }).result_id}`);
      }

      // Rule 3 / grade parity: the UI's grade label is results.grade as
      // published, never recomputed — and the TS mirror (gradeFor) agrees
      // with the real app.grade_for() for the exact percentages this run
      // produced, not just the packet's fixed constants.
      const studentARow = resultRows.find((r) => r.student_id === studentA)!;
      const [{ grade_for: sqlGrade }] = await sql`
        select app.grade_for(${inst.institutionId}::uuid, 'default', ${studentARow.percentage}::numeric) as grade_for
      `;
      expect(studentARow.grade).toBe(sqlGrade);
      expect(gradeFor(DEFAULT_GRADING_BANDS, Number(studentARow.percentage))).toBe(sqlGrade);

      // AC3: guardian.one sees the report card for their own linked child
      // only; a URL for the unrelated student returns nothing (not_found at
      // the page layer) — pure RLS (0009 results_select), not an app-level filter.
      const guardianCtx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian") as unknown as SupabaseClient<Database>);
      try {
        const ownChild = await getCurrentResult(guardianCtx, examId, studentA);
        expect(ownChild).not.toBeNull();
        expect(ownChild?.studentId).toBe(studentA);

        const otherChild = await getCurrentResult(guardianCtx, examId, studentB);
        expect(otherChild).toBeNull();
      } finally {
        setActingClient(null);
      }

      // Exam-role/teacher list view: both students' current results, with a
      // grade distribution summing to 2.
      const controllerCtx = await buildContext(inst, "exam_controller");
      setActingClient(inst.clientAs("exam_controller") as unknown as SupabaseClient<Database>);
      try {
        const summary = await listResultsForExam(controllerCtx, examId);
        expect(summary?.results).toHaveLength(2);
        const totalInDistribution = Object.values(summary?.gradeDistribution ?? {}).reduce((a, b) => a + b, 0);
        expect(totalInDistribution).toBe(2);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
