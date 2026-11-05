import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import {
  acknowledgeDiaryEntry,
  deleteDiaryEntry,
  postDiaryEntry,
} from "@/modules/diary/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
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

// X01-T8 — diary.entry.post / diary.entry.delete / diary.acknowledge. Fixture
// shape mirrors tests/db/diary-rls.test.ts (0085 part 2).

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
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

describe("diary.entry.post (X01-T8)", () => {
  it("class teacher posts for own section -> ok", async () => {
    const inst = await createTestInstitution("diary-actions-post-ok");
    try {
      const base = await makeBase(inst);
      const result = await callAs(inst, "teacher", postDiaryEntry, {
        classSectionId: base.sectionId,
        entryDate: ENTRY_DATE,
        body: "No homework today.",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [row] = await sql`select class_section_id, created_by from public.diary_entries where id = ${result.data.id}::uuid`;
      expect(row.class_section_id).toBe(base.sectionId);
      expect(row.created_by).toBe(inst.users.teacher.id);

      const [audit] = await sql`
        select after from public.audit_events where action = 'diary.entry.posted' and entity_id = ${result.data.id}::uuid
      `;
      expect(audit).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("teacher of another section -> forbidden", async () => {
    const inst = await createTestInstitution("diary-actions-post-wrong-section");
    try {
      const base = await makeBase(inst);
      const otherStaff = await createBareStaff(inst.institutionId);
      const sectionB = await createClassSection(inst.institutionId, base.gradeId, base.yearId, { name: "B", classTeacherId: otherStaff });

      const result = await callAs(inst, "teacher", postDiaryEntry, {
        classSectionId: sectionB,
        entryDate: ENTRY_DATE,
        body: "Not my section.",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("dueDate before entryDate -> validation_failed", async () => {
    const inst = await createTestInstitution("diary-actions-post-bad-due-date");
    try {
      const base = await makeBase(inst);
      const result = await callAs(inst, "teacher", postDiaryEntry, {
        classSectionId: base.sectionId,
        entryDate: ENTRY_DATE,
        dueDate: "2026-06-30",
        body: "Due before entry date.",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("validation_failed");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("guardian post -> forbidden", async () => {
    const inst = await createTestInstitution("diary-actions-post-guardian");
    try {
      const base = await makeBase(inst);
      const result = await callAs(inst, "guardian", postDiaryEntry, {
        classSectionId: base.sectionId,
        entryDate: ENTRY_DATE,
        body: "Guardian attempt.",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});

describe("diary.entry.delete (X01-T8)", () => {
  it("author deletes -> ok", async () => {
    const inst = await createTestInstitution("diary-actions-delete-author");
    try {
      const base = await makeBase(inst);
      const posted = await callAs(inst, "teacher", postDiaryEntry, {
        classSectionId: base.sectionId,
        entryDate: ENTRY_DATE,
        body: "Delete me.",
      });
      expect(posted.ok).toBe(true);
      if (!posted.ok) return;

      const result = await callAs(inst, "teacher", deleteDiaryEntry, { entryId: posted.data.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBe(posted.data.id);

      const rows = await sql`select id from public.diary_entries where id = ${posted.data.id}::uuid`;
      expect(rows).toHaveLength(0);

      const [audit] = await sql`
        select after from public.audit_events where action = 'diary.entry.deleted' and entity_id = ${posted.data.id}::uuid
      `;
      expect(audit).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("non-author teacher (subject teacher, same section) -> forbidden", async () => {
    const inst = await createTestInstitution("diary-actions-delete-non-author");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const classTeacherStaff = await createBareStaff(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: classTeacherStaff });
      const subjectId = await createSubject(inst.institutionId);
      const subjectTeacherStaff = await staffIdFor(inst.institutionId, "teacher");
      await createSubjectAssignment(inst.institutionId, sectionId, subjectId, subjectTeacherStaff);

      // Authored by the (unlinked) class teacher via service role — our
      // logged-in "teacher" fixture is the subject teacher of this section:
      // sees the entry (taught-section SELECT), but isn't its author.
      const [entry] = await sql`
        insert into public.diary_entries (institution_id, class_section_id, entry_date, body, created_by)
        values (${inst.institutionId}, ${sectionId}::uuid, ${ENTRY_DATE}, 'Not yours.', ${inst.users.admin.id}::uuid)
        returning id
      `;

      const result = await callAs(inst, "teacher", deleteDiaryEntry, { entryId: entry.id });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");

      const rows = await sql`select id from public.diary_entries where id = ${entry.id}::uuid`;
      expect(rows).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("other-section teacher (invisible entry) -> not_found", async () => {
    const inst = await createTestInstitution("diary-actions-delete-other-section");
    try {
      // The fixture "teacher" has diary.write (gate passes) but is not
      // linked to this section at all (no class-teacher or subject-teacher
      // role on it) -> the SELECT policy hides the row entirely.
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const otherStaff = await createBareStaff(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { classTeacherId: otherStaff });
      const [entry] = await sql`
        insert into public.diary_entries (institution_id, class_section_id, entry_date, body, created_by)
        values (${inst.institutionId}, ${sectionId}::uuid, ${ENTRY_DATE}, 'Only visible to this section.', ${inst.users.admin.id}::uuid)
        returning id
      `;

      const result = await callAs(inst, "teacher", deleteDiaryEntry, { entryId: entry.id });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});

describe("diary.acknowledge (X01-T8)", () => {
  it("guardian acks twice -> ok both times", async () => {
    const inst = await createTestInstitution("diary-actions-ack-twice");
    try {
      const base = await makeBase(inst);
      const posted = await callAs(inst, "teacher", postDiaryEntry, {
        classSectionId: base.sectionId,
        entryDate: ENTRY_DATE,
        dueDate: DUE_DATE,
        body: "Please acknowledge.",
        requiresAck: true,
      });
      expect(posted.ok).toBe(true);
      if (!posted.ok) return;

      const first = await callAs(inst, "guardian", acknowledgeDiaryEntry, {
        entryId: posted.data.id,
        studentId: base.studentId,
      });
      expect(first.ok).toBe(true);
      if (first.ok) expect(first.data).toEqual({ entryId: posted.data.id, studentId: base.studentId, acknowledged: true });

      const second = await callAs(inst, "guardian", acknowledgeDiaryEntry, {
        entryId: posted.data.id,
        studentId: base.studentId,
      });
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.data).toEqual({ entryId: posted.data.id, studentId: base.studentId, acknowledged: true });

      const rows = await sql`select count(*) from public.diary_acknowledgements where entry_id = ${posted.data.id}::uuid`;
      expect(Number(rows[0].count)).toBe(1);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("ack on an entry without requiresAck -> invalid_state", async () => {
    const inst = await createTestInstitution("diary-actions-ack-no-requires");
    try {
      const base = await makeBase(inst);
      const posted = await callAs(inst, "teacher", postDiaryEntry, {
        classSectionId: base.sectionId,
        entryDate: ENTRY_DATE,
        body: "No ack needed.",
      });
      expect(posted.ok).toBe(true);
      if (!posted.ok) return;

      const result = await callAs(inst, "guardian", acknowledgeDiaryEntry, {
        entryId: posted.data.id,
        studentId: base.studentId,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("teacher ack -> forbidden", async () => {
    const inst = await createTestInstitution("diary-actions-ack-teacher");
    try {
      const base = await makeBase(inst);
      const posted = await callAs(inst, "teacher", postDiaryEntry, {
        classSectionId: base.sectionId,
        entryDate: ENTRY_DATE,
        body: "Please acknowledge.",
        requiresAck: true,
      });
      expect(posted.ok).toBe(true);
      if (!posted.ok) return;

      const result = await callAs(inst, "teacher", acknowledgeDiaryEntry, {
        entryId: posted.data.id,
        studentId: base.studentId,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});
