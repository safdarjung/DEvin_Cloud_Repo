// X01-T9 — src/modules/diary/queries.ts, called directly as plain query
// functions (mirrors tests/db/timetable-queries.test.ts's buildContext +
// setActingClient pattern). Fixture tables mirror tests/db/diary-rls.test.ts
// (0085 part 2): one section, one named student/guardian from
// createTestInstitution, entries inserted via the admin `sql` connection
// (service role bypass — the notify trigger firing or not is T5/T10's
// concern, not this one's).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { diaryAckStatus, diaryForSection, diaryForStudent } from "@/modules/diary/queries";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

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

async function linkGuardian(institutionId: string, guardianId: string, studentId: string): Promise<void> {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${institutionId}, ${guardianId}, ${studentId}, 'father', true, true)
  `;
}

async function createEntry(
  institutionId: string,
  classSectionId: string,
  createdBy: string,
  overrides: Partial<{ subjectId: string | null; entryDate: string; body: string; requiresAck: boolean }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.diary_entries (institution_id, class_section_id, subject_id, entry_date, body, requires_ack, created_by)
    values (
      ${institutionId}, ${classSectionId}, ${overrides.subjectId ?? null}, ${overrides.entryDate ?? "2026-07-01"},
      ${overrides.body ?? "Homework"}, ${overrides.requiresAck ?? false}, ${createdBy}
    )
    returning id
  `;
  return row.id as string;
}

async function ackEntry(institutionId: string, entryId: string, studentId: string, acknowledgedBy: string): Promise<void> {
  await sql`
    insert into public.diary_acknowledgements (institution_id, entry_id, student_id, acknowledged_by)
    values (${institutionId}, ${entryId}, ${studentId}, ${acknowledgedBy})
  `;
}

/** year + section (class teacher = fixture's teacher) + fixture's student enrolled + fixture's guardian linked — mirrors diary-rls.test.ts's makeBase. */
async function makeBase(inst: TestInstitution) {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const teacherStaff = await staffIdFor(inst.institutionId, "teacher");
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: teacherStaff });
  const studentId = await studentIdFor(inst.institutionId);
  const guardianId = await guardianIdFor(inst.institutionId);
  await createEnrolment(inst.institutionId, studentId, sectionId, yearId, { rollNo: 1, status: "active" });
  await linkGuardian(inst.institutionId, guardianId, studentId);
  return { yearId, gradeId, sectionId, teacherStaff, studentId, guardianId };
}

describe("diary queries (X01-T9)", () => {
  it("forSection: newest entry_date first, then created_at; ackCount is null for a caller without diary.write", async () => {
    const inst = await createTestInstitution("diary-q-forsection");
    try {
      const base = await makeBase(inst);
      const subjectId = await createSubject(inst.institutionId, { name: "Mathematics" });
      const older = await createEntry(inst.institutionId, base.sectionId, inst.users.teacher.id, {
        entryDate: "2026-07-01",
        body: "Older entry",
        subjectId,
      });
      const newer = await createEntry(inst.institutionId, base.sectionId, inst.users.teacher.id, {
        entryDate: "2026-07-03",
        body: "Newer entry",
        requiresAck: true,
      });

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const rows = await diaryForSection(ctx, base.sectionId, "2026-06-25", "2026-07-10");
        expect(rows.map((r) => r.id)).toEqual([newer, older]);
        expect(rows[0]).toEqual({
          id: newer,
          entryDate: "2026-07-03",
          subject: null,
          body: "Newer entry",
          dueDate: null,
          requiresAck: true,
          ackCount: null,
        });
        expect(rows[1].subject).toEqual({ id: subjectId, name: "Mathematics" });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("forSection: ackCount counts for a caller with diary.write (the class teacher)", async () => {
    const inst = await createTestInstitution("diary-q-ackcount");
    try {
      const base = await makeBase(inst);
      const entryId = await createEntry(inst.institutionId, base.sectionId, inst.users.teacher.id, {
        entryDate: "2026-07-01",
        requiresAck: true,
      });
      await ackEntry(inst.institutionId, entryId, base.studentId, inst.users.guardian.id);

      const ctx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher"));
      try {
        const rows = await diaryForSection(ctx, base.sectionId, "2026-06-25", "2026-07-10");
        expect(rows).toHaveLength(1);
        expect(rows[0].ackCount).toBe(1);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("forStudent: guardian of own child sees the section's entries with acknowledged set", async () => {
    const inst = await createTestInstitution("diary-q-forstudent-own");
    try {
      const base = await makeBase(inst);
      const acked = await createEntry(inst.institutionId, base.sectionId, inst.users.teacher.id, {
        entryDate: "2026-07-01",
        requiresAck: true,
      });
      const unacked = await createEntry(inst.institutionId, base.sectionId, inst.users.teacher.id, {
        entryDate: "2026-07-02",
        requiresAck: true,
      });
      await ackEntry(inst.institutionId, acked, base.studentId, inst.users.guardian.id);

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const rows = await diaryForStudent(ctx, base.studentId, "2026-06-25", "2026-07-10");
        expect(rows.map((r) => ({ id: r.id, acknowledged: r.acknowledged }))).toEqual([
          { id: unacked, acknowledged: false },
          { id: acked, acknowledged: true },
        ]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("forStudent: another family's guardian gets [] (RLS blocks the enrolment read before any entry lookup)", async () => {
    const inst = await createTestInstitution("diary-q-forstudent-other");
    try {
      const base = await makeBase(inst);
      await createEntry(inst.institutionId, base.sectionId, inst.users.teacher.id, { entryDate: "2026-07-01" });

      const [otherStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2015-01-01', 'other')
        returning id
      `;
      await createEnrolment(inst.institutionId, otherStudent.id, base.sectionId, base.yearId, { rollNo: 2 });

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const rows = await diaryForStudent(ctx, otherStudent.id, "2026-06-25", "2026-07-10");
        expect(rows).toEqual([]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("ackStatus: the class teacher lists the section's active students by roll number, one acknowledged", async () => {
    const inst = await createTestInstitution("diary-q-ackstatus");
    try {
      const base = await makeBase(inst);
      const entryId = await createEntry(inst.institutionId, base.sectionId, inst.users.teacher.id, {
        entryDate: "2026-07-01",
        requiresAck: true,
      });
      await ackEntry(inst.institutionId, entryId, base.studentId, inst.users.guardian.id);

      const ctx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher"));
      try {
        const rows = await diaryAckStatus(ctx, entryId);
        expect(rows).toHaveLength(1);
        expect(rows[0].studentId).toBe(base.studentId);
        expect(rows[0].rollNo).toBe(1);
        expect(rows[0].acknowledged).toBe(true);
        expect(rows[0].acknowledgedAt).not.toBeNull();
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("ackStatus: a teacher of another section gets not_found (the entry is invisible under RLS)", async () => {
    const inst = await createTestInstitution("diary-q-ackstatus-other");
    try {
      const base = await makeBase(inst);
      const ownEntryId = await createEntry(inst.institutionId, base.sectionId, inst.users.teacher.id, {
        entryDate: "2026-07-01",
        requiresAck: true,
      });

      const otherGrade = await createGrade(inst.institutionId, { code: "VIII", sortKey: 8 });
      const [otherStaff] = await sql`
        insert into public.staff (institution_id, employee_no, full_name, designation)
        values (${inst.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Teacher', 'teacher')
        returning id
      `;
      const otherSectionId = await createClassSection(inst.institutionId, otherGrade, base.yearId, {
        classTeacherId: otherStaff.id as string,
      });
      const otherEntryId = await createEntry(inst.institutionId, otherSectionId, inst.users.teacher.id, {
        entryDate: "2026-07-01",
        requiresAck: true,
      });

      const ctx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher"));
      try {
        await expect(diaryAckStatus(ctx, otherEntryId)).rejects.toMatchObject({ code: "not_found" });
        const own = await diaryAckStatus(ctx, ownEntryId);
        expect(own).toHaveLength(1);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
