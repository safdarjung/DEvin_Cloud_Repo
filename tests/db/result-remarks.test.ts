// T-0NN — result_remarks RLS (0047) + the saveResultRemark action, same
// fixture shape as tests/db/exams-publish.test.ts. Two students: `studentA`
// is enrolled in the section the fixture's teacher teaches (math); guardian
// is linked to studentA. `studentB` is enrolled in an untaught section, so
// the teacher has no scope over it — the negative case for both RLS and
// `saveResultRemark`.
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import type { Database } from "@/lib/db/types";
import { saveResultRemark } from "@/modules/exams/actions";
import { getResultRemark } from "@/modules/exams/queries";
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

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

async function insertStudent(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Test', '2014-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

/** A bare published result row — exam-workflow correctness is exams-publish.test.ts's job, not this file's. */
async function insertResult(institutionId: string, examId: string, studentId: string): Promise<string> {
  const [row] = await sql`
    insert into public.results (institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade)
    values (${institutionId}, ${examId}, ${studentId}, '{"subjects":[],"attendancePercentage":100}', 80, 100, 80, 'A')
    returning id
  `;
  return row.id as string;
}

async function setupFixture(institutionId: string, teacherId: string, studentUserId: string, guardianUserId: string) {
  const yearId = await createAcademicYear(institutionId);
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId);
  const taughtSection = await createClassSection(institutionId, gradeId, yearId, { name: "A" });
  const untaughtSection = await createClassSection(institutionId, gradeId, yearId, { name: "B" });
  const mathId = await createSubject(institutionId, { code: "MATH", name: "Mathematics" });
  await createSubjectAssignment(institutionId, taughtSection, mathId, teacherId);

  const [examRow] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (${institutionId}, ${yearId}, ${termId}, 'Unit Test (remarks)', 'unit_test', 'published')
    returning id
  `;
  const examId = examRow.id as string;

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
  await createEnrolment(institutionId, studentA, taughtSection, yearId);

  const studentB = await insertStudent(institutionId);
  await createEnrolment(institutionId, studentB, untaughtSection, yearId);

  const resultA = await insertResult(institutionId, examId, studentA);
  const resultB = await insertResult(institutionId, examId, studentB);

  return { studentA, studentB, resultA, resultB };
}

describe("result_remarks (T-0NN) — RLS scope and the saveResultRemark action", () => {
  it("a teacher saves a remark for a student they teach; an exam_controller and the student's own guardian can read it; the teacher cannot touch an untaught student's result", async () => {
    const inst = await createTestInstitution("result-remarks");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { resultA, resultB } = await setupFixture(
        inst.institutionId,
        teacherId,
        inst.users.student.id,
        inst.users.guardian.id,
      );

      // Teacher may draft+save a remark for the student they teach (AC: saving persists it).
      const saved = await callAs(inst, "teacher", saveResultRemark, { resultId: resultA, remark: "A strong, consistent effort this term." });
      expect(saved).toMatchObject({ ok: true, data: { remark: "A strong, consistent effort this term." } });

      // The teacher edits it — same row, same created_by, no forbidden trip
      // on the created_by-immutability guard trigger (0047).
      const edited = await callAs(inst, "teacher", saveResultRemark, { resultId: resultA, remark: "A strong effort — keep it up." });
      expect(edited).toMatchObject({ ok: true, data: { remark: "A strong effort — keep it up." } });

      const [row] = await sql`select count(*)::int as count from public.result_remarks where result_id = ${resultA}::uuid`;
      expect(row.count).toBe(1); // unique(result_id) — edit, not a second row.

      // The teacher has no scope over studentB's (untaught section) result —
      // results_select (0020) already hides its existence from them, so the
      // action's own institution-scoped lookup sees nothing and reports
      // not_found (06 §1.1: existence outside scope is never revealed), not
      // a silent no-op and not a leaking "forbidden".
      const blocked = await callAs(inst, "teacher", saveResultRemark, { resultId: resultB, remark: "Should never save." });
      expect(blocked).toMatchObject({ ok: false, error: { code: "not_found" } });

      // AC: it then shows on the guardian/student report card — pure RLS read (result_remarks_select).
      const guardianCtx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian") as unknown as SupabaseClient<Database>);
      try {
        expect(await getResultRemark(guardianCtx, resultA)).toBe("A strong effort — keep it up.");
        expect(await getResultRemark(guardianCtx, resultB)).toBeNull(); // not their child
      } finally {
        setActingClient(null);
      }

      // exam_controller (app.exam_roles()) reads every remark in the institution.
      const controllerCtx = await buildContext(inst, "exam_controller");
      setActingClient(inst.clientAs("exam_controller") as unknown as SupabaseClient<Database>);
      try {
        expect(await getResultRemark(controllerCtx, resultA)).toBe("A strong effort — keep it up.");
        expect(await getResultRemark(controllerCtx, resultB)).toBeNull(); // no remark was ever saved for B
      } finally {
        setActingClient(null);
      }

      // admin holds app.exam_roles() (read-only — results_select's
      // institution-wide branch includes admin, unlike app.exam_write_roles()
      // which excludes it, lesson #1) — so admin reads every remark too.
      const adminCtx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin") as unknown as SupabaseClient<Database>);
      try {
        expect(await getResultRemark(adminCtx, resultA)).toBe("A strong effort — keep it up.");
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("fix round 1 MED-3: a different in-scope role can overwrite a teacher's remark, but created_by never changes and both saves are audited with the real actor", async () => {
    const inst = await createTestInstitution("result-remarks-attribution");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { resultA } = await setupFixture(inst.institutionId, teacherId, inst.users.student.id, inst.users.guardian.id);

      const created = await callAs(inst, "teacher", saveResultRemark, { resultId: resultA, remark: "First draft by the teacher." });
      expect(created).toMatchObject({ ok: true });

      // principal (app.exam_write_roles()) overwrites it — no created_by
      // conflict error, since saveResultRemark never touches created_by on
      // the UPDATE path.
      const overwritten = await callAs(inst, "principal", saveResultRemark, { resultId: resultA, remark: "Overwritten by the principal." });
      expect(overwritten).toMatchObject({ ok: true, data: { remark: "Overwritten by the principal." } });

      const [row] = await sql`select created_by from public.result_remarks where result_id = ${resultA}::uuid`;
      expect(row.created_by).toBe(inst.users.teacher.id); // immutable — still the original author

      const auditRows = await sql`
        select actor_user_id, metadata from public.audit_events
        where institution_id = ${inst.institutionId}::uuid and action = 'exam.remark.save'
        order by created_at asc
      `;
      expect(auditRows).toHaveLength(2);
      expect(auditRows[0].actor_user_id).toBe(inst.users.teacher.id);
      expect(auditRows[0].metadata).toMatchObject({ created: true });
      expect(auditRows[1].actor_user_id).toBe(inst.users.principal.id);
      expect(auditRows[1].metadata).toMatchObject({ created: false });
      // Never the remark text itself (no free-form user content in audit).
      for (const row of auditRows) {
        expect(JSON.stringify(row.metadata)).not.toContain("draft");
        expect(JSON.stringify(row.metadata)).not.toContain("Overwritten");
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("fix round 1 LOW-1: a remark cannot be written against an already-superseded result version", async () => {
    const inst = await createTestInstitution("result-remarks-superseded");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { resultA } = await setupFixture(inst.institutionId, teacherId, inst.users.student.id, inst.users.guardian.id);

      // Simulate a recheck superseding resultA with a new current version —
      // same shape as apply_recheck_decision's old-row-then-new-row order
      // (0009), without exercising the full recheck RPC (out of this file's
      // scope; exams-publish.test.ts/exams-recheck tests own that).
      // `results_one_current_check` is a deferred constraint trigger (0009:
      // "one current row" is enforced at commit, not per-statement), so the
      // insert-then-update pair must run in one transaction — same order
      // apply_recheck_decision itself uses.
      const [newVersion] = await sql.begin(async (tx) => {
        const [inserted] = await tx`
          insert into public.results (institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade, version_no)
          select institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade, 2
          from public.results where id = ${resultA}::uuid
          returning id
        `;
        await tx`update public.results set superseded_by = ${inserted.id}::uuid where id = ${resultA}::uuid`;
        return [inserted];
      });

      // App-layer: the action's own lookup now excludes superseded rows —
      // clean not_found, not a raw RLS-violation error.
      const blocked = await callAs(inst, "teacher", saveResultRemark, { resultId: resultA, remark: "Too late." });
      expect(blocked).toMatchObject({ ok: false, error: { code: "not_found" } });

      // RLS itself: a direct insert against the superseded row is rejected
      // even bypassing the action's own guard (0048's WITH CHECK fix).
      const teacherClient = inst.clientAs("teacher");
      const { error } = await teacherClient.from("result_remarks").insert({
        institution_id: inst.institutionId,
        result_id: resultA,
        remark: "Direct insert, still too late.",
        created_by: inst.users.teacher.id,
      });
      expect(error).not.toBeNull();

      // The new current version is unaffected — still writable.
      const onCurrent = await callAs(inst, "teacher", saveResultRemark, { resultId: newVersion.id, remark: "Written against the current version." });
      expect(onCurrent).toMatchObject({ ok: true });
    } finally {
      await inst.cleanup();
    }
  });

  it("a direct RLS insert with a forged created_by is rejected", async () => {
    const inst = await createTestInstitution("result-remarks-forge");
    try {
      const teacherId = await teacherStaffId(inst.institutionId);
      const { resultA } = await setupFixture(inst.institutionId, teacherId, inst.users.student.id, inst.users.guardian.id);

      const teacherClient = inst.clientAs("teacher");
      const { error } = await teacherClient.from("result_remarks").insert({
        institution_id: inst.institutionId,
        result_id: resultA,
        remark: "Forged.",
        created_by: inst.users.guardian.id, // not the caller
      });
      expect(error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});
