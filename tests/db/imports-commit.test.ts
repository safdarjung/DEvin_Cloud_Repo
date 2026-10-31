import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

// Direct-SQL setup (bypasses RLS, same as every other tests/db fixture) —
// one current academic year + grade + section per test institution so
// `commit_import_batch`'s enrolment insert has a real class_section_id/
// academic_year_id to satisfy the enrolments_insert FK-scope check (0036).
async function setupAcademicStructure(institutionId: string) {
  const [year] = await sql`
    insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
    values (${institutionId}, '2026-27', '2026-04-01', '2027-03-31', true)
    returning id
  `;
  const [grade] = await sql`
    insert into public.grades (institution_id, code, display_name, sort_key, grade_group)
    values (${institutionId}, 'G1', 'Grade 1', 1, 'primary')
    returning id
  `;
  const [section] = await sql`
    insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
    values (${institutionId}, ${grade.id}, ${year.id}, 'A')
    returning id
  `;
  return { academicYearId: year.id as string, classSectionId: section.id as string };
}

function studentRowData(opts: {
  admissionNo: string;
  academicYearId: string;
  classSectionId: string;
  guardianPhone: string;
}) {
  return {
    admission_no: opts.admissionNo,
    first_name: "Test",
    last_name: "Student",
    dob: "2016-01-01",
    gender: "other",
    class_section_id: opts.classSectionId,
    academic_year_id: opts.academicYearId,
    roll_no: null,
    guardian_name: "Test Guardian",
    guardian_phone: opts.guardianPhone,
    guardian_email: null,
    guardian_relationship: "father",
  };
}

async function insertBatch(institutionId: string, entityType: "students" | "staff") {
  const [batch] = await sql`
    insert into public.import_batches (institution_id, entity_type, file_name)
    values (${institutionId}, ${entityType}, 'test.csv')
    returning id
  `;
  return batch.id as string;
}

async function insertValidRow(
  batchId: string,
  institutionId: string,
  rowNo: number,
  data: Record<string, string | number | boolean | null>,
) {
  await sql`
    insert into public.import_rows (batch_id, institution_id, row_no, data, status)
    values (${batchId}, ${institutionId}, ${rowNo}, ${sql.json(data)}, 'valid')
  `;
  // Mirror staging: row_count always equals the rows written for the batch.
  await sql`update public.import_batches set row_count = row_count + 1 where id = ${batchId}`;
}

describe("commit_import_batch (M04-T3)", () => {
  it("a batch with fewer rows than its row_count (partial stage) → invalid_state", async () => {
    const inst = await createTestInstitution("imports-commit-partial");
    try {
      const batchId = await insertBatch(inst.institutionId, "staff");
      await sql`update public.import_batches set row_count = 2 where id = ${batchId}`;
      const { error } = await inst.clientAs("admin").rpc("commit_import_batch", { p_batch_id: batchId });
      expect(error?.message).toBe("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("3 valid rows + 1 duplicate admission_no → 3 committed, 1 skipped", async () => {
    const inst = await createTestInstitution("imports-commit-dup");
    try {
      const { academicYearId, classSectionId } = await setupAcademicStructure(inst.institutionId);

      await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, 'ADM-DUP', 'Existing', '2015-01-01', 'other')
      `;

      const batchId = await insertBatch(inst.institutionId, "students");
      await insertValidRow(
        batchId, inst.institutionId, 2,
        studentRowData({ admissionNo: "ADM-1", academicYearId, classSectionId, guardianPhone: "9111111111" }),
      );
      await insertValidRow(
        batchId, inst.institutionId, 3,
        studentRowData({ admissionNo: "ADM-2", academicYearId, classSectionId, guardianPhone: "9222222222" }),
      );
      await insertValidRow(
        batchId, inst.institutionId, 4,
        studentRowData({ admissionNo: "ADM-3", academicYearId, classSectionId, guardianPhone: "9333333333" }),
      );
      await insertValidRow(
        batchId, inst.institutionId, 5,
        studentRowData({ admissionNo: "ADM-DUP", academicYearId, classSectionId, guardianPhone: "9444444444" }),
      );

      const { data, error } = await inst.clientAs("admin").rpc("commit_import_batch", { p_batch_id: batchId });
      expect(error).toBeNull();
      expect(data).toEqual({ committed: 3, skipped: 1, invalid: 0 });

      const rows = await sql`select row_no, status from public.import_rows where batch_id = ${batchId} order by row_no`;
      expect(rows.map((r) => r.status)).toEqual(["committed", "committed", "committed", "skipped"]);

      const dupStudents = await sql`
        select count(*)::int as n from public.students where institution_id = ${inst.institutionId} and admission_no = 'ADM-DUP'
      `;
      expect(dupStudents[0].n).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("a row with a bad guardian phone → invalid with an error, the other row still commits", async () => {
    const inst = await createTestInstitution("imports-commit-badphone");
    try {
      const { academicYearId, classSectionId } = await setupAcademicStructure(inst.institutionId);
      const batchId = await insertBatch(inst.institutionId, "students");

      await insertValidRow(
        batchId, inst.institutionId, 2,
        studentRowData({ admissionNo: "ADM-GOOD", academicYearId, classSectionId, guardianPhone: "9555555555" }),
      );
      await insertValidRow(
        batchId, inst.institutionId, 3,
        studentRowData({ admissionNo: "ADM-BAD", academicYearId, classSectionId, guardianPhone: "12345" }),
      );

      const { data, error } = await inst.clientAs("admin").rpc("commit_import_batch", { p_batch_id: batchId });
      expect(error).toBeNull();
      expect(data).toEqual({ committed: 1, skipped: 0, invalid: 1 });

      const [badRow] = await sql`
        select status, errors from public.import_rows where batch_id = ${batchId} and row_no = 3
      `;
      expect(badRow.status).toBe("invalid");
      expect(badRow.errors).toHaveLength(1);
      // never echoes row data (lesson 10)
      expect(JSON.stringify(badRow.errors)).not.toContain("12345");

      const badStudent = await sql`
        select count(*)::int as n from public.students where institution_id = ${inst.institutionId} and admission_no = 'ADM-BAD'
      `;
      expect(badStudent[0].n).toBe(0);

      const goodStudent = await sql`
        select count(*)::int as n from public.students where institution_id = ${inst.institutionId} and admission_no = 'ADM-GOOD'
      `;
      expect(goodStudent[0].n).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("recommitting a committed batch returns the same counts and writes nothing new", async () => {
    const inst = await createTestInstitution("imports-commit-recommit");
    try {
      const { academicYearId, classSectionId } = await setupAcademicStructure(inst.institutionId);
      const batchId = await insertBatch(inst.institutionId, "students");
      await insertValidRow(
        batchId, inst.institutionId, 2,
        studentRowData({ admissionNo: "ADM-ONCE", academicYearId, classSectionId, guardianPhone: "9666666666" }),
      );

      const first = await inst.clientAs("admin").rpc("commit_import_batch", { p_batch_id: batchId });
      expect(first.error).toBeNull();
      expect(first.data).toEqual({ committed: 1, skipped: 0, invalid: 0 });

      const second = await inst.clientAs("admin").rpc("commit_import_batch", { p_batch_id: batchId });
      expect(second.error).toBeNull();
      expect(second.data).toEqual(first.data);

      const students = await sql`
        select count(*)::int as n from public.students where institution_id = ${inst.institutionId} and admission_no = 'ADM-ONCE'
      `;
      expect(students[0].n).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher cannot commit an import batch", async () => {
    const inst = await createTestInstitution("imports-commit-teacher");
    try {
      const batchId = await insertBatch(inst.institutionId, "students");

      const { error } = await inst.clientAs("teacher").rpc("commit_import_batch", { p_batch_id: batchId });
      expect(error).not.toBeNull();
      expect(error?.message ?? "").toContain("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("a staff batch commits staff rows", async () => {
    const inst = await createTestInstitution("imports-commit-staff");
    try {
      const batchId = await insertBatch(inst.institutionId, "staff");
      await insertValidRow(batchId, inst.institutionId, 2, {
        employee_no: "EMP-NEW-1",
        full_name: "New Teacher",
        designation: "Teacher",
        department_id: null,
        phone: null,
        email: null,
        is_teaching: true,
      });

      const { data, error } = await inst.clientAs("admin").rpc("commit_import_batch", { p_batch_id: batchId });
      expect(error).toBeNull();
      expect(data).toEqual({ committed: 1, skipped: 0, invalid: 0 });

      const [staff] = await sql`
        select is_teaching from public.staff where institution_id = ${inst.institutionId} and employee_no = 'EMP-NEW-1'
      `;
      expect(staff.is_teaching).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("a guardian is reused by phone across two imported students in the same batch", async () => {
    const inst = await createTestInstitution("imports-commit-guardian-reuse");
    try {
      const { academicYearId, classSectionId } = await setupAcademicStructure(inst.institutionId);
      const batchId = await insertBatch(inst.institutionId, "students");
      const sharedPhone = "9777777777";

      await insertValidRow(
        batchId, inst.institutionId, 2,
        studentRowData({ admissionNo: "ADM-SIB-1", academicYearId, classSectionId, guardianPhone: sharedPhone }),
      );
      await insertValidRow(
        batchId, inst.institutionId, 3,
        studentRowData({ admissionNo: "ADM-SIB-2", academicYearId, classSectionId, guardianPhone: sharedPhone }),
      );

      const { data, error } = await inst.clientAs("admin").rpc("commit_import_batch", { p_batch_id: batchId });
      expect(error).toBeNull();
      expect(data).toEqual({ committed: 2, skipped: 0, invalid: 0 });

      const guardians = await sql`
        select id from public.guardians where institution_id = ${inst.institutionId} and phone = ${sharedPhone}
      `;
      expect(guardians).toHaveLength(1);

      const links = await sql`
        select student_id from public.guardian_students where guardian_id = ${guardians[0].id}
      `;
      expect(links).toHaveLength(2);
    } finally {
      await inst.cleanup();
    }
  });
});
