import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function insertStudent(institutionId: string, admissionNo: string) {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function buildYears(inst: TestInstitution) {
  const fromYearId = await createAcademicYear(inst.institutionId, {
    name: "2026-27",
    startsOn: "2026-04-01",
    endsOn: "2027-03-31",
    isCurrent: false,
  });
  const toYearId = await createAcademicYear(inst.institutionId, {
    name: "2027-28",
    startsOn: "2027-04-01",
    endsOn: "2028-03-31",
    isCurrent: true,
  });
  const gradeId = await createGrade(inst.institutionId);
  return { fromYearId, toYearId, gradeId };
}

async function enrolmentRow(enrolmentId: string) {
  const [row] = await sql`select * from public.enrolments where id = ${enrolmentId}`;
  return row;
}

async function studentRow(studentId: string) {
  const [row] = await sql`select * from public.students where id = ${studentId}`;
  return row;
}

async function eventsFor(studentId: string) {
  return sql`select * from public.student_lifecycle_events where student_id = ${studentId} order by created_at`;
}

describe("migration 0076 part 2: public.promote_students", () => {
  it("maps two sections, completes the old rows, opens active rows in the to-year, and shares one batch_id", async () => {
    const inst = await createTestInstitution("lc-promote-map");
    try {
      const { fromYearId, toYearId, gradeId } = await buildYears(inst);
      const sectionA = await createClassSection(inst.institutionId, gradeId, fromYearId, { name: "A" });
      const sectionB = await createClassSection(inst.institutionId, gradeId, fromYearId, { name: "B" });
      const sectionA2 = await createClassSection(inst.institutionId, gradeId, toYearId, { name: "A2" });
      const sectionB2 = await createClassSection(inst.institutionId, gradeId, toYearId, { name: "B2" });

      const studentA = await insertStudent(inst.institutionId, "ADM-PR-A");
      const studentB = await insertStudent(inst.institutionId, "ADM-PR-B");
      const enrolmentA = await createEnrolment(inst.institutionId, studentA, sectionA, fromYearId, { rollNo: 1 });
      const enrolmentB = await createEnrolment(inst.institutionId, studentB, sectionB, fromYearId, { rollNo: 1 });

      const { data, error } = await inst.clientAs("admin").rpc("promote_students", {
        p_from_year_id: fromYearId,
        p_to_year_id: toYearId,
        p_mappings: [
          { from_section_id: sectionA, to_section_id: sectionA2 },
          { from_section_id: sectionB, to_section_id: sectionB2 },
        ],
      });
      expect(error).toBeNull();
      expect(data.promoted).toBe(2);
      expect(data.graduated).toBe(0);
      expect(data.skipped_student_ids).toEqual([]);

      const oldA = await enrolmentRow(enrolmentA);
      const oldB = await enrolmentRow(enrolmentB);
      expect(oldA.status).toBe("completed");
      expect(oldA.ended_on.toISOString().slice(0, 10)).toBe("2027-03-31");
      expect(oldB.status).toBe("completed");

      const [newA] = await sql`
        select * from public.enrolments where student_id = ${studentA} and academic_year_id = ${toYearId}
      `;
      expect(newA.status).toBe("active");
      expect(newA.class_section_id).toBe(sectionA2);
      expect(newA.started_on.toISOString().slice(0, 10)).toBe("2027-04-01");

      const eventsA = await eventsFor(studentA);
      const eventsB = await eventsFor(studentB);
      expect(eventsA).toHaveLength(1);
      expect(eventsA[0].kind).toBe("promoted");
      expect(eventsA[0].batch_id).toBe(data.batch_id);
      expect(eventsB[0].batch_id).toBe(data.batch_id);

      const [history] = await sql`
        select * from public.enrolment_status_history where enrolment_id = ${enrolmentA} order by created_at desc limit 1
      `;
      expect(history.from_status).toBe("active");
      expect(history.to_status).toBe("completed");
      expect(history.changed_by).toBe(inst.users.admin.id);
    } finally {
      await inst.cleanup();
    }
  });

  it("a null target section graduates: the row completes, the student becomes alumni, and a graduated event is written with no new enrolment", async () => {
    const inst = await createTestInstitution("lc-promote-graduate");
    try {
      const { fromYearId, toYearId, gradeId } = await buildYears(inst);
      const sectionA = await createClassSection(inst.institutionId, gradeId, fromYearId, { name: "A" });
      const studentId = await insertStudent(inst.institutionId, "ADM-PR-GRAD");
      const enrolmentId = await createEnrolment(inst.institutionId, studentId, sectionA, fromYearId, { rollNo: 1 });

      const { data, error } = await inst.clientAs("admin").rpc("promote_students", {
        p_from_year_id: fromYearId,
        p_to_year_id: toYearId,
        p_mappings: [{ from_section_id: sectionA, to_section_id: null }],
      });
      expect(error).toBeNull();
      expect(data.promoted).toBe(0);
      expect(data.graduated).toBe(1);

      const oldRow = await enrolmentRow(enrolmentId);
      expect(oldRow.status).toBe("completed");

      const student = await studentRow(studentId);
      expect(student.status).toBe("alumni");

      const [newRow] = await sql`select id from public.enrolments where student_id = ${studentId} and academic_year_id = ${toYearId}`;
      expect(newRow).toBeUndefined();

      const events = await eventsFor(studentId);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe("graduated");
      expect(events[0].to_enrolment_id).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("an override moves one student to a same-grade section even without a matching mapping", async () => {
    const inst = await createTestInstitution("lc-promote-override");
    try {
      const { fromYearId, toYearId, gradeId } = await buildYears(inst);
      const sectionA = await createClassSection(inst.institutionId, gradeId, fromYearId, { name: "A" });
      const sectionOther2 = await createClassSection(inst.institutionId, gradeId, toYearId, { name: "Other2" });
      const studentId = await insertStudent(inst.institutionId, "ADM-PR-OVR");
      await createEnrolment(inst.institutionId, studentId, sectionA, fromYearId, { rollNo: 1 });

      const { data, error } = await inst.clientAs("admin").rpc("promote_students", {
        p_from_year_id: fromYearId,
        p_to_year_id: toYearId,
        p_mappings: [],
        p_overrides: [{ student_id: studentId, to_section_id: sectionOther2 }],
      });
      expect(error).toBeNull();
      expect(data.promoted).toBe(1);

      const [newRow] = await sql`select class_section_id from public.enrolments where student_id = ${studentId} and academic_year_id = ${toYearId}`;
      expect(newRow.class_section_id).toBe(sectionOther2);
    } finally {
      await inst.cleanup();
    }
  });

  it("an excluded student stays active in the from-year and is untouched", async () => {
    const inst = await createTestInstitution("lc-promote-exclude");
    try {
      const { fromYearId, toYearId, gradeId } = await buildYears(inst);
      const sectionA = await createClassSection(inst.institutionId, gradeId, fromYearId, { name: "A" });
      const sectionA2 = await createClassSection(inst.institutionId, gradeId, toYearId, { name: "A2" });
      const studentId = await insertStudent(inst.institutionId, "ADM-PR-EXCL");
      const enrolmentId = await createEnrolment(inst.institutionId, studentId, sectionA, fromYearId, { rollNo: 1 });

      const { data, error } = await inst.clientAs("admin").rpc("promote_students", {
        p_from_year_id: fromYearId,
        p_to_year_id: toYearId,
        p_mappings: [{ from_section_id: sectionA, to_section_id: sectionA2 }],
        p_exclude: [studentId],
      });
      expect(error).toBeNull();
      expect(data.promoted).toBe(0);
      expect(data.skipped_student_ids).toEqual([]);

      const row = await enrolmentRow(enrolmentId);
      expect(row.status).toBe("active");
    } finally {
      await inst.cleanup();
    }
  });

  it("is idempotent: calling again with the same mapping returns zero counts and leaves row counts unchanged", async () => {
    const inst = await createTestInstitution("lc-promote-idempotent");
    try {
      const { fromYearId, toYearId, gradeId } = await buildYears(inst);
      const sectionA = await createClassSection(inst.institutionId, gradeId, fromYearId, { name: "A" });
      const sectionA2 = await createClassSection(inst.institutionId, gradeId, toYearId, { name: "A2" });
      const studentId = await insertStudent(inst.institutionId, "ADM-PR-IDEMP");
      await createEnrolment(inst.institutionId, studentId, sectionA, fromYearId, { rollNo: 1 });

      const args = {
        p_from_year_id: fromYearId,
        p_to_year_id: toYearId,
        p_mappings: [{ from_section_id: sectionA, to_section_id: sectionA2 }],
      };
      const first = await inst.clientAs("admin").rpc("promote_students", args);
      expect(first.error).toBeNull();
      expect(first.data.promoted).toBe(1);

      const [countBefore] = await sql`select count(*)::int as n from public.enrolments where student_id = ${studentId}`;

      const second = await inst.clientAs("admin").rpc("promote_students", args);
      expect(second.error).toBeNull();
      expect(second.data.promoted).toBe(0);
      expect(second.data.graduated).toBe(0);

      const [countAfter] = await sql`select count(*)::int as n from public.enrolments where student_id = ${studentId}`;
      expect(countAfter.n).toBe(countBefore.n);
    } finally {
      await inst.cleanup();
    }
  });

  it("a student already active in the to-year is skipped and their old row stays active", async () => {
    const inst = await createTestInstitution("lc-promote-already-active");
    try {
      const { fromYearId, toYearId, gradeId } = await buildYears(inst);
      const sectionA = await createClassSection(inst.institutionId, gradeId, fromYearId, { name: "A" });
      const sectionA2 = await createClassSection(inst.institutionId, gradeId, toYearId, { name: "A2" });
      const studentId = await insertStudent(inst.institutionId, "ADM-PR-ALREADY");
      const oldEnrolmentId = await createEnrolment(inst.institutionId, studentId, sectionA, fromYearId, { rollNo: 1 });
      // Already enrolled (e.g. a manual admin action) in the to-year before the batch runs.
      await createEnrolment(inst.institutionId, studentId, sectionA2, toYearId, { rollNo: 1 });

      const { data, error } = await inst.clientAs("admin").rpc("promote_students", {
        p_from_year_id: fromYearId,
        p_to_year_id: toYearId,
        p_mappings: [{ from_section_id: sectionA, to_section_id: sectionA2 }],
      });
      expect(error).toBeNull();
      expect(data.promoted).toBe(0);
      expect(data.skipped_student_ids).toEqual([studentId]);

      const row = await enrolmentRow(oldEnrolmentId);
      expect(row.status).toBe("active");
    } finally {
      await inst.cleanup();
    }
  });

  it("a target section from the from-year, or from another institution, is validation_failed", async () => {
    const inst = await createTestInstitution("lc-promote-bad-target");
    const other = await createTestInstitution("lc-promote-other-inst");
    try {
      const { fromYearId, toYearId, gradeId } = await buildYears(inst);
      const sectionA = await createClassSection(inst.institutionId, gradeId, fromYearId, { name: "A" });

      const fromYearSection = await inst.clientAs("admin").rpc("promote_students", {
        p_from_year_id: fromYearId,
        p_to_year_id: toYearId,
        p_mappings: [{ from_section_id: sectionA, to_section_id: sectionA }],
      });
      expect(fromYearSection.error?.message).toContain("code:validation_failed");

      const otherYears = await buildYears(other);
      const otherSection2 = await createClassSection(other.institutionId, otherYears.gradeId, otherYears.toYearId, { name: "X2" });
      const crossInstitution = await inst.clientAs("admin").rpc("promote_students", {
        p_from_year_id: fromYearId,
        p_to_year_id: toYearId,
        p_mappings: [{ from_section_id: sectionA, to_section_id: otherSection2 }],
      });
      expect(crossInstitution.error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
      await other.cleanup();
    }
  });

  it("admissions and teacher are forbidden from promoting", async () => {
    const inst = await createTestInstitution("lc-promote-forbidden");
    try {
      const { fromYearId, toYearId, gradeId } = await buildYears(inst);
      const sectionA = await createClassSection(inst.institutionId, gradeId, fromYearId, { name: "A" });
      const sectionA2 = await createClassSection(inst.institutionId, gradeId, toYearId, { name: "A2" });

      const admissions = await inst.clientAs("admissions").rpc("promote_students", {
        p_from_year_id: fromYearId,
        p_to_year_id: toYearId,
        p_mappings: [{ from_section_id: sectionA, to_section_id: sectionA2 }],
      });
      expect(admissions.error?.message).toContain("code:forbidden");

      const teacher = await inst.clientAs("teacher").rpc("promote_students", {
        p_from_year_id: fromYearId,
        p_to_year_id: toYearId,
        p_mappings: [{ from_section_id: sectionA, to_section_id: sectionA2 }],
      });
      expect(teacher.error?.message).toContain("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
