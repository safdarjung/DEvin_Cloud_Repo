import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// X01-T5 — migration 0085 part 2: diary_entries + diary_acknowledgements +
// app.enqueue_diary_entry_notification. Same fixture shape as
// tests/db/student-leave-rls.test.ts (0085 part 1).

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const ENTRY_DATE = "2026-07-01";
const DUE_DATE = "2026-07-08";

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.staff_id as string;
}

async function studentIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select student_id from public.memberships where institution_id = ${institutionId} and role = 'student'`;
  return row.student_id as string;
}

async function guardianIdFor(institutionId: string): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${institutionId} and role = 'guardian'`;
  return row.guardian_id as string;
}

async function createBareStaff(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Teacher', 'teacher')
    returning id
  `;
  return row.id as string;
}

async function createBareStudent(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Not Mine', '2016-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function linkGuardian(institutionId: string, guardianId: string, studentId: string): Promise<void> {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
}

/** year + section (class teacher = fixture's teacher) + fixture's student enrolled + fixture's guardian linked. */
async function makeBase(inst: TestInstitution) {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const teacherStaff = await staffIdFor(inst.institutionId, "teacher");
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: teacherStaff });
  const studentId = await studentIdFor(inst.institutionId);
  const guardianId = await guardianIdFor(inst.institutionId);
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { status: "active" });
  await linkGuardian(inst.institutionId, guardianId, studentId);
  return { yearId, gradeId, sectionId, teacherStaff, studentId, guardianId };
}

describe("diary migration (0085 part 2) — diary_entries RLS + notify trigger", () => {
  it("class teacher posts for own section -> ok and one notify.diary_entry job with {entry_id} only", async () => {
    const inst = await createTestInstitution("diary-class-teacher");
    try {
      const base = await makeBase(inst);

      const inserted = await inst
        .clientAs("teacher")
        .from("diary_entries")
        .insert({
          institution_id: inst.institutionId,
          class_section_id: base.sectionId,
          entry_date: ENTRY_DATE,
          body: "No homework today.",
          created_by: inst.users.teacher.id,
        })
        .select("id")
        .single();
      expect(inserted.error).toBeNull();

      const jobs = await sql`
        select payload from public.jobs
        where type = 'notify.diary_entry' and idempotency_key = ${`diary:${inserted.data!.id}`}
      `;
      expect(jobs).toHaveLength(1);
      expect(Object.keys(jobs[0].payload)).toEqual(["entry_id"]);
      expect(jobs[0].payload.entry_id).toBe(inserted.data!.id);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("subject teacher of the section -> ok", async () => {
    const inst = await createTestInstitution("diary-subject-teacher");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const classTeacherStaff = await createBareStaff(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: classTeacherStaff });
      const subjectId = await createSubject(inst.institutionId);
      const subjectTeacherStaff = await staffIdFor(inst.institutionId, "teacher");
      await createSubjectAssignment(inst.institutionId, sectionId, subjectId, subjectTeacherStaff);

      const inserted = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: sectionId,
        subject_id: subjectId,
        entry_date: ENTRY_DATE,
        body: "Chapter 3 homework.",
        created_by: inst.users.teacher.id,
      });
      expect(inserted.error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("teacher of another section -> 42501", async () => {
    const inst = await createTestInstitution("diary-wrong-section");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const teacherStaff = await staffIdFor(inst.institutionId, "teacher");
      await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: teacherStaff });
      const otherStaff = await createBareStaff(inst.institutionId);
      const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B", classTeacherId: otherStaff });

      const { error } = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: sectionB,
        entry_date: ENTRY_DATE,
        body: "Not my section.",
        created_by: inst.users.teacher.id,
      });
      expect(error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("admin of A posting with B's class_section_id -> 42501", async () => {
    const instA = await createTestInstitution("diary-admin-cross-a");
    const instB = await createTestInstitution("diary-admin-cross-b");
    try {
      const baseB = await makeBase(instB);

      const { error } = await instA.clientAs("admin").from("diary_entries").insert({
        institution_id: instA.institutionId,
        class_section_id: baseB.sectionId,
        entry_date: ENTRY_DATE,
        body: "Cross-tenant section.",
        created_by: instA.users.admin.id,
      });
      expect(error?.code).toBe("42501");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  }, 20_000);

  it("admin of A posting with B's subject_id -> 42501", async () => {
    const instA = await createTestInstitution("diary-admin-subject-a");
    const instB = await createTestInstitution("diary-admin-subject-b");
    try {
      const baseA = await makeBase(instA);
      const subjectB = await createSubject(instB.institutionId);

      const { error } = await instA.clientAs("admin").from("diary_entries").insert({
        institution_id: instA.institutionId,
        class_section_id: baseA.sectionId,
        subject_id: subjectB,
        entry_date: ENTRY_DATE,
        body: "Cross-tenant subject.",
        created_by: instA.users.admin.id,
      });
      expect(error?.code).toBe("42501");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  }, 20_000);

  it("spoofed created_by -> 42501", async () => {
    const inst = await createTestInstitution("diary-spoof-created-by");
    try {
      const base = await makeBase(inst);

      const { error } = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: ENTRY_DATE,
        body: "Spoofed author.",
        created_by: inst.users.admin.id,
      });
      expect(error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("guardian of a VI-A child sees VI-A entries, not VIII-B", async () => {
    const inst = await createTestInstitution("diary-guardian-scope");
    try {
      const base = await makeBase(inst); // VI-A, fixture's student + guardian
      const otherStaff = await createBareStaff(inst.institutionId);
      const sectionB = await createClassSection(inst.institutionId, base.gradeId, base.yearId, { name: "B", classTeacherId: otherStaff });

      const entryA = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: ENTRY_DATE,
        body: "VI-A note.",
        created_by: inst.users.teacher.id,
      }).select("id").single();
      expect(entryA.error).toBeNull();

      await sql`
        insert into public.diary_entries (institution_id, class_section_id, entry_date, body, created_by)
        values (${inst.institutionId}, ${sectionB}::uuid, ${ENTRY_DATE}, 'VIII-B note.', ${inst.users.admin.id}::uuid)
      `;

      const { data, error } = await inst.clientAs("guardian").from("diary_entries").select("id, class_section_id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0].id).toBe(entryA.data!.id);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("student sees own section", async () => {
    const inst = await createTestInstitution("diary-student-scope");
    try {
      const base = await makeBase(inst);

      const entry = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: ENTRY_DATE,
        body: "Own section note.",
        created_by: inst.users.teacher.id,
      }).select("id").single();
      expect(entry.error).toBeNull();

      const { data, error } = await inst.clientAs("student").from("diary_entries").select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("accountant sees none", async () => {
    const inst = await createTestInstitution("diary-accountant-scope");
    try {
      const base = await makeBase(inst);

      await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: ENTRY_DATE,
        body: "Not for accountant.",
        created_by: inst.users.teacher.id,
      });

      const { data, error } = await inst.clientAs("accountant").from("diary_entries").select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("service-role insert -> no notify job", async () => {
    const inst = await createTestInstitution("diary-service-role");
    try {
      const base = await makeBase(inst);

      const [row] = await sql`
        insert into public.diary_entries (institution_id, class_section_id, entry_date, body, created_by)
        values (${inst.institutionId}, ${base.sectionId}::uuid, ${ENTRY_DATE}, 'Seeded note.', ${inst.users.teacher.id}::uuid)
        returning id
      `;

      const jobs = await sql`
        select count(*) from public.jobs where type = 'notify.diary_entry' and idempotency_key = ${`diary:${row.id}`}
      `;
      expect(Number(jobs[0].count)).toBe(0);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("direct UPDATE of diary_entries is denied", async () => {
    const inst = await createTestInstitution("diary-direct-update");
    try {
      const base = await makeBase(inst);

      const entry = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: ENTRY_DATE,
        body: "Immutable note.",
        created_by: inst.users.teacher.id,
      }).select("id").single();

      const update = await inst
        .clientAs("teacher")
        .from("diary_entries")
        .update({ body: "Edited note." })
        .eq("id", entry.data!.id)
        .select("id");
      expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);

      const [row] = await sql`select body from public.diary_entries where id = ${entry.data!.id}::uuid`;
      expect(row.body).toBe("Immutable note.");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("author deletes -> acknowledgements cascade", async () => {
    const inst = await createTestInstitution("diary-delete-author");
    try {
      const base = await makeBase(inst);

      const entry = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: ENTRY_DATE,
        body: "Ack then delete.",
        requires_ack: true,
        created_by: inst.users.teacher.id,
      }).select("id").single();
      expect(entry.error).toBeNull();
      const entryId = entry.data!.id as string;

      const ack = await inst.clientAs("guardian").from("diary_acknowledgements").insert({
        institution_id: inst.institutionId,
        entry_id: entryId,
        student_id: base.studentId,
        acknowledged_by: inst.users.guardian.id,
      });
      expect(ack.error).toBeNull();

      const del = await inst.clientAs("teacher").from("diary_entries").delete().eq("id", entryId).select("id");
      expect(del.error).toBeNull();
      expect(del.data).toHaveLength(1);

      const remainingAcks = await sql`select count(*) from public.diary_acknowledgements where entry_id = ${entryId}::uuid`;
      expect(Number(remainingAcks[0].count)).toBe(0);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("non-author teacher delete -> 0 rows", async () => {
    const inst = await createTestInstitution("diary-delete-non-author");
    try {
      const base = await makeBase(inst);

      const entry = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: ENTRY_DATE,
        body: "Only the author deletes.",
        created_by: inst.users.teacher.id,
      }).select("id").single();

      const del = await inst.clientAs("admissions").from("diary_entries").delete().eq("id", entry.data!.id).select("id");
      expect(del.error === null).toBe(true);
      expect((del.data ?? []).length).toBe(0);

      const [row] = await sql`select id from public.diary_entries where id = ${entry.data!.id}::uuid`;
      expect(row).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});

describe("diary migration (0085 part 2) — diary_acknowledgements RLS", () => {
  it("guardian acks own child's requires_ack entry -> ok; second time -> 23505", async () => {
    const inst = await createTestInstitution("diary-ack-own-child");
    try {
      const base = await makeBase(inst);

      const entry = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: ENTRY_DATE,
        due_date: DUE_DATE,
        body: "Please acknowledge.",
        requires_ack: true,
        created_by: inst.users.teacher.id,
      }).select("id").single();
      expect(entry.error).toBeNull();

      const first = await inst.clientAs("guardian").from("diary_acknowledgements").insert({
        institution_id: inst.institutionId,
        entry_id: entry.data!.id,
        student_id: base.studentId,
        acknowledged_by: inst.users.guardian.id,
      });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("guardian").from("diary_acknowledgements").insert({
        institution_id: inst.institutionId,
        entry_id: entry.data!.id,
        student_id: base.studentId,
        acknowledged_by: inst.users.guardian.id,
      });
      expect(second.error?.code).toBe("23505");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("ack on an entry without requires_ack -> 42501", async () => {
    const inst = await createTestInstitution("diary-ack-no-requires");
    try {
      const base = await makeBase(inst);

      const entry = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: ENTRY_DATE,
        body: "No ack needed.",
        created_by: inst.users.teacher.id,
      }).select("id").single();

      const { error } = await inst.clientAs("guardian").from("diary_acknowledgements").insert({
        institution_id: inst.institutionId,
        entry_id: entry.data!.id,
        student_id: base.studentId,
        acknowledged_by: inst.users.guardian.id,
      });
      expect(error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("ack for another family's child -> 42501", async () => {
    const inst = await createTestInstitution("diary-ack-other-child");
    try {
      const base = await makeBase(inst);
      const otherStudent = await createBareStudent(inst.institutionId);
      await createEnrolment(inst.institutionId, otherStudent, base.sectionId, base.yearId, { status: "active" });

      const entry = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: ENTRY_DATE,
        body: "Please acknowledge.",
        requires_ack: true,
        created_by: inst.users.teacher.id,
      }).select("id").single();

      const { error } = await inst.clientAs("guardian").from("diary_acknowledgements").insert({
        institution_id: inst.institutionId,
        entry_id: entry.data!.id,
        student_id: otherStudent,
        acknowledged_by: inst.users.guardian.id,
      });
      expect(error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("teacher ack -> 42501", async () => {
    const inst = await createTestInstitution("diary-ack-teacher");
    try {
      const base = await makeBase(inst);

      const entry = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: ENTRY_DATE,
        body: "Please acknowledge.",
        requires_ack: true,
        created_by: inst.users.teacher.id,
      }).select("id").single();

      const { error } = await inst.clientAs("teacher").from("diary_acknowledgements").insert({
        institution_id: inst.institutionId,
        entry_id: entry.data!.id,
        student_id: base.studentId,
        acknowledged_by: inst.users.teacher.id,
      });
      expect(error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("teacher reads acks of a taught section; accountant reads none", async () => {
    const inst = await createTestInstitution("diary-ack-read-scope");
    try {
      const base = await makeBase(inst);

      const entry = await inst.clientAs("teacher").from("diary_entries").insert({
        institution_id: inst.institutionId,
        class_section_id: base.sectionId,
        entry_date: ENTRY_DATE,
        body: "Please acknowledge.",
        requires_ack: true,
        created_by: inst.users.teacher.id,
      }).select("id").single();

      const ack = await inst.clientAs("guardian").from("diary_acknowledgements").insert({
        institution_id: inst.institutionId,
        entry_id: entry.data!.id,
        student_id: base.studentId,
        acknowledged_by: inst.users.guardian.id,
      });
      expect(ack.error).toBeNull();

      const teacherRead = await inst.clientAs("teacher").from("diary_acknowledgements").select("id");
      expect(teacherRead.error).toBeNull();
      expect(teacherRead.data).toHaveLength(1);

      // Accountant has no student link and doesn't teach the section ->
      // reads no acknowledgement rows (neither app.my_student_ids() nor
      // the taught-section exists() clause match).
      const accountantRead = await inst.clientAs("accountant").from("diary_acknowledgements").select("id");
      expect(accountantRead.error).toBeNull();
      expect(accountantRead.data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});
