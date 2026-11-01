import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createAcademicYear, createClassSection, createEnrolment, createGrade, createSubject, closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

async function createRoom(institutionId: string, overrides: Partial<{ name: string; capacity: number }> = {}): Promise<string> {
  const [row] = await sql`
    insert into public.rooms (institution_id, name, capacity)
    values (${institutionId}, ${overrides.name ?? `Room-${crypto.randomUUID().slice(0, 6)}`}, ${overrides.capacity ?? 30})
    returning id
  `;
  return row.id as string;
}

async function createPeriod(
  institutionId: string,
  overrides: Partial<{ seq: number; name: string; startsAt: string; endsAt: string; isBreak: boolean }> = {},
): Promise<string> {
  const seq = overrides.seq ?? 1;
  const [row] = await sql`
    insert into public.periods (institution_id, seq, name, starts_at, ends_at, is_break)
    values (${institutionId}, ${seq}, ${overrides.name ?? `Period ${seq}`}, ${overrides.startsAt ?? "09:00"}, ${overrides.endsAt ?? "09:40"}, ${overrides.isBreak ?? false})
    returning id
  `;
  return row.id as string;
}

async function createDraftVersion(institutionId: string, academicYearId: string, createdBy: string, overrides: Partial<{ name: string }> = {}): Promise<string> {
  const [row] = await sql`
    insert into public.timetable_versions (institution_id, academic_year_id, name, created_by)
    values (${institutionId}, ${academicYearId}, ${overrides.name ?? "Term Timetable"}, ${createdBy})
    returning id
  `;
  return row.id as string;
}

interface Base {
  yearId: string;
  sectionA: string;
  sectionB: string;
  teacherId: string;
  roomId: string;
  periodId: string;
  breakPeriodId: string;
  subjectId: string;
}

async function buildBase(inst: TestInstitution): Promise<Base> {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
  const teacherId = await teacherStaffId(inst.institutionId);
  const roomId = await createRoom(inst.institutionId);
  const periodId = await createPeriod(inst.institutionId, { seq: 1 });
  const breakPeriodId = await createPeriod(inst.institutionId, { seq: 2, isBreak: true });
  const subjectId = await createSubject(inst.institutionId);
  return { yearId, sectionA, sectionB, teacherId, roomId, periodId, breakPeriodId, subjectId };
}

describe("timetable migration (0069) RLS + publish_timetable", () => {
  it("admin builds a draft version with two non-conflicting slots", async () => {
    const inst = await createTestInstitution("tt-draft-build");
    try {
      const base = await buildBase(inst);
      const version = await createDraftVersion(inst.institutionId, base.yearId, inst.users.admin.id);

      const slot1 = await inst.clientAs("admin").from("timetable_slots").insert({
        institution_id: inst.institutionId,
        version_id: version,
        class_section_id: base.sectionA,
        subject_id: base.subjectId,
        teacher_id: base.teacherId,
        room_id: base.roomId,
        weekday: 1,
        period_id: base.periodId,
      });
      expect(slot1.error).toBeNull();

      const slot2 = await inst.clientAs("admin").from("timetable_slots").insert({
        institution_id: inst.institutionId,
        version_id: version,
        class_section_id: base.sectionB,
        subject_id: base.subjectId,
        teacher_id: base.teacherId,
        weekday: 2,
        period_id: base.periodId,
      });
      expect(slot2.error).toBeNull();

      const [row] = await sql`select status from public.timetable_versions where id = ${version}`;
      expect(row.status).toBe("draft");
    } finally {
      await inst.cleanup();
    }
  });

  it("same teacher double-booked in two sections at the same weekday+period is rejected (23505)", async () => {
    const inst = await createTestInstitution("tt-teacher-conflict");
    try {
      const base = await buildBase(inst);
      const version = await createDraftVersion(inst.institutionId, base.yearId, inst.users.admin.id);

      const first = await inst.clientAs("admin").from("timetable_slots").insert({
        institution_id: inst.institutionId,
        version_id: version,
        class_section_id: base.sectionA,
        subject_id: base.subjectId,
        teacher_id: base.teacherId,
        weekday: 1,
        period_id: base.periodId,
      });
      expect(first.error).toBeNull();

      const conflict = await inst.clientAs("admin").from("timetable_slots").insert({
        institution_id: inst.institutionId,
        version_id: version,
        class_section_id: base.sectionB,
        subject_id: base.subjectId,
        teacher_id: base.teacherId,
        weekday: 1,
        period_id: base.periodId,
      });
      expect(conflict.error?.code).toBe("23505");
      expect(conflict.error?.message).toContain("timetable_slots_teacher_slot_key");
    } finally {
      await inst.cleanup();
    }
  });

  it("same room double-booked at the same weekday+period across sections is rejected (23505)", async () => {
    const inst = await createTestInstitution("tt-room-conflict");
    try {
      const base = await buildBase(inst);
      const version = await createDraftVersion(inst.institutionId, base.yearId, inst.users.admin.id);
      const otherTeacherStaff = await sql`
        insert into public.staff (institution_id, employee_no, full_name, designation)
        values (${inst.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Teacher', 'teacher')
        returning id
      `;

      const first = await inst.clientAs("admin").from("timetable_slots").insert({
        institution_id: inst.institutionId,
        version_id: version,
        class_section_id: base.sectionA,
        subject_id: base.subjectId,
        teacher_id: base.teacherId,
        room_id: base.roomId,
        weekday: 1,
        period_id: base.periodId,
      });
      expect(first.error).toBeNull();

      const conflict = await inst.clientAs("admin").from("timetable_slots").insert({
        institution_id: inst.institutionId,
        version_id: version,
        class_section_id: base.sectionB,
        subject_id: base.subjectId,
        teacher_id: otherTeacherStaff[0].id,
        room_id: base.roomId,
        weekday: 1,
        period_id: base.periodId,
      });
      expect(conflict.error?.code).toBe("23505");
      expect(conflict.error?.message).toContain("timetable_slots_room_unique_idx");
    } finally {
      await inst.cleanup();
    }
  });

  it("a slot on a break period is rejected", async () => {
    const inst = await createTestInstitution("tt-break-period");
    try {
      const base = await buildBase(inst);
      const version = await createDraftVersion(inst.institutionId, base.yearId, inst.users.admin.id);

      const { error } = await inst.clientAs("admin").from("timetable_slots").insert({
        institution_id: inst.institutionId,
        version_id: version,
        class_section_id: base.sectionA,
        subject_id: base.subjectId,
        teacher_id: base.teacherId,
        weekday: 1,
        period_id: base.breakPeriodId,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("publish moves draft -> published and archives the previous published version of the same year", async () => {
    const inst = await createTestInstitution("tt-publish");
    try {
      const base = await buildBase(inst);
      const firstVersion = await createDraftVersion(inst.institutionId, base.yearId, inst.users.admin.id, { name: "V1" });
      const firstPublish = await inst.clientAs("admin").rpc("publish_timetable", { p_version_id: firstVersion });
      expect(firstPublish.error).toBeNull();
      expect(firstPublish.data.status).toBe("published");

      const secondVersion = await createDraftVersion(inst.institutionId, base.yearId, inst.users.admin.id, { name: "V2" });
      const secondPublish = await inst.clientAs("admin").rpc("publish_timetable", { p_version_id: secondVersion });
      expect(secondPublish.error).toBeNull();
      expect(secondPublish.data.status).toBe("published");
      expect(secondPublish.data.published_at).not.toBeNull();

      const [firstRow] = await sql`select status from public.timetable_versions where id = ${firstVersion}`;
      expect(firstRow.status).toBe("archived");
    } finally {
      await inst.cleanup();
    }
  });

  it("publishing twice is rejected as invalid_state; a non-manager cannot publish", async () => {
    const inst = await createTestInstitution("tt-publish-guard");
    try {
      const base = await buildBase(inst);
      const version = await createDraftVersion(inst.institutionId, base.yearId, inst.users.admin.id);

      const teacherAttempt = await inst.clientAs("teacher").rpc("publish_timetable", { p_version_id: version });
      expect(teacherAttempt.error?.message).toContain("code:forbidden");

      const published = await inst.clientAs("admin").rpc("publish_timetable", { p_version_id: version });
      expect(published.error).toBeNull();

      const twice = await inst.clientAs("admin").rpc("publish_timetable", { p_version_id: version });
      expect(twice.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("editing a slot after its version is published is rejected", async () => {
    const inst = await createTestInstitution("tt-edit-after-publish");
    try {
      const base = await buildBase(inst);
      const version = await createDraftVersion(inst.institutionId, base.yearId, inst.users.admin.id);
      const { data: slot } = await inst
        .clientAs("admin")
        .from("timetable_slots")
        .insert({
          institution_id: inst.institutionId,
          version_id: version,
          class_section_id: base.sectionA,
          subject_id: base.subjectId,
          teacher_id: base.teacherId,
          weekday: 1,
          period_id: base.periodId,
        })
        .select("id")
        .single();

      const publish = await inst.clientAs("admin").rpc("publish_timetable", { p_version_id: version });
      expect(publish.error).toBeNull();

      const edit = await inst.clientAs("admin").from("timetable_slots").update({ weekday: 3 }).eq("id", slot!.id);
      expect(edit.error).not.toBeNull();
      expect(edit.error?.message).toContain("code:invalid_state");

      const del = await inst.clientAs("admin").from("timetable_slots").delete().eq("id", slot!.id);
      expect(del.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian sees only their own child's section's published slots, never drafts", async () => {
    const inst = await createTestInstitution("tt-guardian-scope");
    try {
      const base = await buildBase(inst);
      const version = await createDraftVersion(inst.institutionId, base.yearId, inst.users.admin.id);

      const [guardianLink] = await sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`;
      const [studentLink] = await sql`select student_id from public.memberships where institution_id = ${inst.institutionId} and role = 'student'`;
      await createEnrolment(inst.institutionId, studentLink.student_id, base.sectionA, base.yearId, { rollNo: 1 });
      await sql`
        insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
        values (${inst.institutionId}, ${guardianLink.guardian_id}, ${studentLink.student_id}, 'mother', true)
      `;

      const ownSlot = await sql`
        insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
        values (${inst.institutionId}, ${version}, ${base.sectionA}, ${base.subjectId}, ${base.teacherId}, 1, ${base.periodId})
        returning id
      `;
      const otherTeacherStaff = await sql`
        insert into public.staff (institution_id, employee_no, full_name, designation)
        values (${inst.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Other Teacher', 'teacher')
        returning id
      `;
      const otherSlot = await sql`
        insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
        values (${inst.institutionId}, ${version}, ${base.sectionB}, ${base.subjectId}, ${otherTeacherStaff[0].id}, 2, ${base.periodId})
        returning id
      `;

      const beforePublish = await inst.clientAs("guardian").from("timetable_slots").select("id");
      expect(beforePublish.data).toEqual([]);

      const publish = await inst.clientAs("admin").rpc("publish_timetable", { p_version_id: version });
      expect(publish.error).toBeNull();

      const afterPublish = await inst.clientAs("guardian").from("timetable_slots").select("id");
      const visibleIds = afterPublish.data?.map((r) => r.id) ?? [];
      expect(visibleIds).toEqual([ownSlot[0].id]);
      expect(visibleIds).not.toContain(otherSlot[0].id);
    } finally {
      await inst.cleanup();
    }
  });

  it("a non-manager staff role (teacher) sees published slots of any section, never drafts", async () => {
    const inst = await createTestInstitution("tt-teacher-scope");
    try {
      const base = await buildBase(inst);
      const draftVersion = await createDraftVersion(inst.institutionId, base.yearId, inst.users.admin.id, { name: "Draft" });
      const draftSlot = await sql`
        insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
        values (${inst.institutionId}, ${draftVersion}, ${base.sectionA}, ${base.subjectId}, ${base.teacherId}, 1, ${base.periodId})
        returning id
      `;

      const publishedVersion = await createDraftVersion(inst.institutionId, base.yearId, inst.users.admin.id, { name: "Published" });
      const publishedSlot = await sql`
        insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
        values (${inst.institutionId}, ${publishedVersion}, ${base.sectionB}, ${base.subjectId}, ${base.teacherId}, 2, ${base.periodId})
        returning id
      `;
      const publish = await inst.clientAs("admin").rpc("publish_timetable", { p_version_id: publishedVersion });
      expect(publish.error).toBeNull();

      const visible = await inst.clientAs("teacher").from("timetable_slots").select("id");
      const visibleIds = visible.data?.map((r) => r.id) ?? [];
      expect(visibleIds).toContain(publishedSlot[0].id);
      expect(visibleIds).not.toContain(draftSlot[0].id);
    } finally {
      await inst.cleanup();
    }
  });

  it("admin of institution A cannot reference institution B's teacher or room in a slot", async () => {
    const instA = await createTestInstitution("tt-cross-a");
    const instB = await createTestInstitution("tt-cross-b");
    try {
      const baseA = await buildBase(instA);
      const baseB = await buildBase(instB);
      const versionA = await createDraftVersion(instA.institutionId, baseA.yearId, instA.users.admin.id);

      const crossTeacher = await instA.clientAs("admin").from("timetable_slots").insert({
        institution_id: instA.institutionId,
        version_id: versionA,
        class_section_id: baseA.sectionA,
        subject_id: baseA.subjectId,
        teacher_id: baseB.teacherId,
        weekday: 1,
        period_id: baseA.periodId,
      });
      expect(crossTeacher.error).not.toBeNull();

      const crossRoom = await instA.clientAs("admin").from("timetable_slots").insert({
        institution_id: instA.institutionId,
        version_id: versionA,
        class_section_id: baseA.sectionA,
        subject_id: baseA.subjectId,
        teacher_id: baseA.teacherId,
        room_id: baseB.roomId,
        weekday: 1,
        period_id: baseA.periodId,
      });
      expect(crossRoom.error).not.toBeNull();
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("rooms and periods: all active members read, only owner/principal/admin write", async () => {
    const inst = await createTestInstitution("tt-rooms-periods");
    try {
      const roomId = await createRoom(inst.institutionId, { name: "Lab 1" });

      const teacherRead = await inst.clientAs("teacher").from("rooms").select("id").eq("id", roomId);
      expect(teacherRead.data).toHaveLength(1);

      const teacherWrite = await inst.clientAs("teacher").from("rooms").insert({ institution_id: inst.institutionId, name: "New Room", capacity: 10 });
      expect(teacherWrite.error).not.toBeNull();

      const adminWrite = await inst.clientAs("admin").from("periods").insert({
        institution_id: inst.institutionId,
        seq: 5,
        name: "Period 5",
        starts_at: "13:00",
        ends_at: "13:40",
      });
      expect(adminWrite.error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});
