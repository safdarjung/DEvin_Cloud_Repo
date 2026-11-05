import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { upsertGrade, upsertSection, upsertSubject, setSubjectAssignment } from "@/modules/academics/setup.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// M03-T9 — academics.grade.upsert / academics.section.upsert /
// academics.subject.upsert / academics.subjectAssignment.set. Columns
// exactly as 0005: grades.{code, display_name, sort_key, grade_group},
// subjects.{code, name, kind}, class_sections.{grade_id, academic_year_id,
// name, capacity, class_teacher_id}, subject_assignments.{class_section_id,
// subject_id, teacher_id} — matches tests/helpers/factories.ts's existing
// createGrade/createSubject/createClassSection/createSubjectAssignment.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

async function createStaffRow(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Test Teacher', 'Teacher')
    returning id
  `;
  return row.id as string;
}

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

describe("academics setup actions (M03-T9)", () => {
  it("admin creates grade -> section -> subject -> assignment", async () => {
    const inst = await createTestInstitution("academics-setup-ok");
    const yearId = await createAcademicYear(inst.institutionId);
    const teacherId = await createStaffRow(inst.institutionId);

    const grade = await callAs(inst, "admin", upsertGrade, {
      code: "VI",
      displayName: "Grade VI",
      sortKey: 6,
      gradeGroup: "middle",
    });
    expect(grade.ok).toBe(true);
    if (!grade.ok) return;

    const section = await callAs(inst, "admin", upsertSection, {
      gradeId: grade.data.id,
      academicYearId: yearId,
      name: "A",
    });
    expect(section.ok).toBe(true);
    if (!section.ok) return;

    const subject = await callAs(inst, "admin", upsertSubject, {
      code: "MATH",
      name: "Mathematics",
      kind: "scholastic",
    });
    expect(subject.ok).toBe(true);
    if (!subject.ok) return;

    const assignment = await callAs(inst, "admin", setSubjectAssignment, {
      classSectionId: section.data.id,
      subjectId: subject.data.id,
      teacherId,
    });
    expect(assignment.ok).toBe(true);
    if (!assignment.ok) return;
    expect(assignment.data.classSectionId).toBe(section.data.id);
    expect(assignment.data.subjectId).toBe(subject.data.id);
    expect(assignment.data.teacherId).toBe(teacherId);
  });

  it("a teacher is forbidden from creating a grade", async () => {
    const inst = await createTestInstitution("academics-setup-forbidden");

    const result = await callAs(inst, "teacher", upsertGrade, {
      code: "VI",
      displayName: "Grade VI",
      sortKey: 6,
      gradeGroup: "middle",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });

  it("a section pointing at another institution's grade is rejected (0065)", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const yearA = await createAcademicYear(instA.institutionId);
      const gradeB = await createGrade(instB.institutionId);

      const result = await callAs(instA, "admin", upsertSection, {
        gradeId: gradeB,
        academicYearId: yearA,
        name: "A",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // 0065's class_sections_insert `with check` rejects this at the RLS
      // layer (SQLSTATE 42501); mapSqlError maps 42501 to `forbidden` since M12.
      expect(result.error.code).toBe("forbidden");
    });
  });

  it("a duplicate subject assignment for the same section+subject is a conflict", async () => {
    const inst = await createTestInstitution("academics-setup-assignment-conflict");
    const yearId = await createAcademicYear(inst.institutionId);
    const teacherId = await createStaffRow(inst.institutionId);
    const otherTeacherId = await createStaffRow(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId);

    const section = await callAs(inst, "admin", upsertSection, {
      gradeId,
      academicYearId: yearId,
      name: "B",
    });
    expect(section.ok).toBe(true);
    if (!section.ok) return;

    const subject = await callAs(inst, "admin", upsertSubject, {
      code: "ENG",
      name: "English",
      kind: "scholastic",
    });
    expect(subject.ok).toBe(true);
    if (!subject.ok) return;

    const first = await callAs(inst, "admin", setSubjectAssignment, {
      classSectionId: section.data.id,
      subjectId: subject.data.id,
      teacherId,
    });
    expect(first.ok).toBe(true);

    const second = await callAs(inst, "admin", setSubjectAssignment, {
      classSectionId: section.data.id,
      subjectId: subject.data.id,
      teacherId: otherTeacherId,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("conflict");
  });
});
