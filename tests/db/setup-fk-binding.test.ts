import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeFactoriesHelper, createAcademicYear, createGrade, createSubject } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// M03-T3 (migration 0065, lesson 2): terms/class_sections/staff/
// curriculum_units INSERT/UPDATE policies (0002/0004/0005) checked only the
// caller's role, never that a user-supplied FK pointed inside the row's own
// institution — same hole 0036 closed for enrolments/subject_assignments.
// Each "cannot" case creates a legit row in institution B, then institution
// A's admin tries to point their own row's FK at it.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function createDepartment(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.departments (institution_id, name) values (${institutionId}, 'Science') returning id
  `;
  return row.id as string;
}

async function createStaffRow(
  institutionId: string,
  overrides: Partial<{ departmentId: string | null }> = {},
): Promise<string> {
  const departmentId = overrides.departmentId ?? null;
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation, department_id)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Test Staff', 'Teacher', ${departmentId})
    returning id
  `;
  return row.id as string;
}

describe("setup-table FK binding (0065) RLS", () => {
  it("admin of A cannot create a section in A pointing at B's grade", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const yearA = await createAcademicYear(instA.institutionId);
      const gradeB = await createGrade(instB.institutionId);

      const insert = await instA.clientAs("admin").from("class_sections").insert({
        institution_id: instA.institutionId,
        grade_id: gradeB,
        academic_year_id: yearA,
        name: "X",
      });
      expect(insert.error).not.toBeNull();
    });
  });

  it("admin of A cannot create a term in A pointing at B's academic year", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const yearB = await createAcademicYear(instB.institutionId);

      const insert = await instA.clientAs("admin").from("terms").insert({
        institution_id: instA.institutionId,
        academic_year_id: yearB,
        name: "Term X",
        sequence: 9,
        starts_on: "2026-04-01",
        ends_on: "2026-09-30",
      });
      expect(insert.error).not.toBeNull();
    });
  });

  it("admin of A cannot create staff in A pointing at B's department", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const deptB = await createDepartment(instB.institutionId);

      const insert = await instA.clientAs("admin").from("staff").insert({
        institution_id: instA.institutionId,
        employee_no: `EMP-${crypto.randomUUID().slice(0, 8)}`,
        full_name: "Cross Tenant",
        designation: "Teacher",
        department_id: deptB,
      });
      expect(insert.error).not.toBeNull();
    });
  });

  it("admin of A cannot create a section in A with B's staff as class_teacher_id", async () => {
    await withTwoInstitutions(async (instA, instB) => {
      const yearA = await createAcademicYear(instA.institutionId);
      const gradeA = await createGrade(instA.institutionId);
      const staffB = await createStaffRow(instB.institutionId);

      const insert = await instA.clientAs("admin").from("class_sections").insert({
        institution_id: instA.institutionId,
        grade_id: gradeA,
        academic_year_id: yearA,
        class_teacher_id: staffB,
        name: "Y",
      });
      expect(insert.error).not.toBeNull();
    });
  });

  it("valid same-institution inserts across all four tables still work", async () => {
    const inst = await createTestInstitution("fk-binding-valid");
    try {
      const yearA = await createAcademicYear(inst.institutionId);
      const gradeA = await createGrade(inst.institutionId);
      const deptA = await createDepartment(inst.institutionId);
      const subjectA = await createSubject(inst.institutionId);
      const teacherStaffA = await createStaffRow(inst.institutionId, { departmentId: deptA });

      const term = await inst.clientAs("admin").from("terms").insert({
        institution_id: inst.institutionId,
        academic_year_id: yearA,
        name: "Term Valid",
        sequence: 8,
        starts_on: "2026-04-01",
        ends_on: "2026-09-30",
      });
      expect(term.error).toBeNull();

      const section = await inst.clientAs("admin").from("class_sections").insert({
        institution_id: inst.institutionId,
        grade_id: gradeA,
        academic_year_id: yearA,
        class_teacher_id: teacherStaffA,
        name: "Valid",
      });
      expect(section.error).toBeNull();

      const staffInsert = await inst.clientAs("admin").from("staff").insert({
        institution_id: inst.institutionId,
        employee_no: `EMP-${crypto.randomUUID().slice(0, 8)}`,
        full_name: "Valid Staff",
        designation: "Teacher",
        department_id: deptA,
      });
      expect(staffInsert.error).toBeNull();

      const curriculumUnit = await inst.clientAs("admin").from("curriculum_units").insert({
        institution_id: inst.institutionId,
        subject_id: subjectA,
        grade_id: gradeA,
        title: "Valid Unit",
        sequence: 1,
      });
      expect(curriculumUnit.error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});
