import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createAcademicYear, createClassSection, createGrade, createSubject, closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`
    select staff_id from public.memberships
    where institution_id = ${institutionId} and role = ${role}
  `;
  return row.staff_id as string;
}

async function createOtherTeacher(institutionId: string, name = "Other Teacher"): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${name}, 'teacher', true)
    returning id
  `;
  return row.id as string;
}

async function createPeriod(institutionId: string, seq: number): Promise<string> {
  const startHour = 8 + seq;
  const [row] = await sql`
    insert into public.periods (institution_id, seq, name, starts_at, ends_at)
    values (${institutionId}, ${seq}, ${`Period ${seq}`}, ${`${startHour}:00`}, ${`${startHour}:40`})
    returning id
  `;
  return row.id as string;
}

async function createDraftVersion(institutionId: string, academicYearId: string, createdBy: string): Promise<string> {
  const [row] = await sql`
    insert into public.timetable_versions (institution_id, academic_year_id, name, created_by)
    values (${institutionId}, ${academicYearId}, 'Term Timetable', ${createdBy})
    returning id
  `;
  return row.id as string;
}

async function publishVersion(institutionId: string, versionId: string, adminUserId: string): Promise<void> {
  const [row] = await sql`
    update public.timetable_versions set status = 'published', published_at = now(), published_by = ${adminUserId}
    where id = ${versionId}
    returning id
  `;
  if (!row) throw new Error("publish failed");
}

/** Next date (today or later) whose ISO weekday (1=Mon..6=Sat) is `isodow`. */
function nextDateForIsodow(isodow: number, minDaysAhead = 3): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  // JS getUTCDay(): 0=Sun..6=Sat. ISO dow: 1=Mon..7=Sun.
  const currentIsodow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const diff = (isodow - currentIsodow + 7) % 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

interface Base {
  yearId: string;
  sectionId: string;
  subjectId: string;
  periodId: string;
  teacherId: string;
  versionId: string;
  slotId: string;
  weekday: number;
  date: string;
}

async function buildPublishedSlot(inst: TestInstitution): Promise<Base> {
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
  const subjectId = await createSubject(inst.institutionId);
  const periodId = await createPeriod(inst.institutionId, 1);
  const teacherId = await staffIdFor(inst.institutionId, "teacher");
  const versionId = await createDraftVersion(inst.institutionId, yearId, inst.users.admin.id);
  const weekday = 1; // Monday
  const date = nextDateForIsodow(weekday);

  const [slot] = await sql`
    insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
    values (${inst.institutionId}, ${versionId}, ${sectionId}, ${subjectId}, ${teacherId}, ${weekday}, ${periodId})
    returning id
  `;
  await publishVersion(inst.institutionId, versionId, inst.users.admin.id);

  return { yearId, sectionId, subjectId, periodId, teacherId, versionId, slotId: slot.id as string, weekday, date };
}

describe("staffing migration (0070 part 2) — substitutions RLS + assign/cancel RPCs", () => {
  it("admin assigns a free teacher to a published slot -> assigned with period/original copied", async () => {
    const inst = await createTestInstitution("sub-assign");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);

      const { data, error } = await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: base.slotId,
        p_date: base.date,
        p_substitute_id: substituteId,
      });
      expect(error).toBeNull();
      expect(data.status).toBe("assigned");
      expect(data.period_id).toBe(base.periodId);
      expect(data.original_teacher_id).toBe(base.teacherId);
      expect(data.substitute_teacher_id).toBe(substituteId);
    } finally {
      await inst.cleanup();
    }
  });

  it("substitute who teaches at that period elsewhere -> conflict", async () => {
    const inst = await createTestInstitution("sub-busy-period");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);
      const otherSectionId = await createClassSection(inst.institutionId, await createGrade(inst.institutionId, { code: "VII", sortKey: 7 }), base.yearId, { name: "B" });
      await sql`
        insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
        values (${inst.institutionId}, ${base.versionId}, ${otherSectionId}, ${base.subjectId}, ${substituteId}, ${base.weekday}, ${base.periodId})
      `;

      const { error } = await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: base.slotId,
        p_date: base.date,
        p_substitute_id: substituteId,
      });
      expect(error?.message).toContain("code:conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("same substitute assigned to two slots at the same date+period -> conflict", async () => {
    const inst = await createTestInstitution("sub-double-booked");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);
      const otherTeacherId = await createOtherTeacher(inst.institutionId, "Second Teacher");
      const otherSectionId = await createClassSection(inst.institutionId, await createGrade(inst.institutionId, { code: "VII", sortKey: 7 }), base.yearId, { name: "B" });
      const [otherSlot] = await sql`
        insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
        values (${inst.institutionId}, ${base.versionId}, ${otherSectionId}, ${base.subjectId}, ${otherTeacherId}, ${base.weekday}, ${base.periodId})
        returning id
      `;

      const first = await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: base.slotId,
        p_date: base.date,
        p_substitute_id: substituteId,
      });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: otherSlot.id,
        p_date: base.date,
        p_substitute_id: substituteId,
      });
      expect(second.error?.message).toContain("code:conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("a second substitution for the same slot+date -> conflict", async () => {
    const inst = await createTestInstitution("sub-slot-twice");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteA = await createOtherTeacher(inst.institutionId, "Sub A");
      const substituteB = await createOtherTeacher(inst.institutionId, "Sub B");

      const first = await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: base.slotId,
        p_date: base.date,
        p_substitute_id: substituteA,
      });
      expect(first.error).toBeNull();

      const second = await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: base.slotId,
        p_date: base.date,
        p_substitute_id: substituteB,
      });
      expect(second.error?.message).toContain("code:conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("substitute on approved leave covering the date -> conflict", async () => {
    const inst = await createTestInstitution("sub-on-leave");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);
      await sql`
        insert into public.leave_requests (institution_id, staff_id, leave_type, start_date, end_date, reason, status, created_by, decided_by, decided_at)
        values (${inst.institutionId}, ${substituteId}, 'sick', ${base.date}, ${base.date}, 'Sick', 'approved', ${inst.users.admin.id}, ${inst.users.admin.id}, now())
      `;

      const { error } = await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: base.slotId,
        p_date: base.date,
        p_substitute_id: substituteId,
      });
      expect(error?.message).toContain("code:conflict");
    } finally {
      await inst.cleanup();
    }
  });

  it("date whose weekday does not match the slot's weekday -> validation_failed", async () => {
    const inst = await createTestInstitution("sub-weekday-mismatch");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);
      const mismatchedDate = nextDateForIsodow(base.weekday === 6 ? 1 : base.weekday + 1);

      const { error } = await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: base.slotId,
        p_date: mismatchedDate,
        p_substitute_id: substituteId,
      });
      expect(error?.message).toContain("code:validation_failed");
    } finally {
      await inst.cleanup();
    }
  });

  it("slot whose version is still draft -> invalid_state", async () => {
    const inst = await createTestInstitution("sub-draft-version");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const subjectId = await createSubject(inst.institutionId);
      const periodId = await createPeriod(inst.institutionId, 1);
      const teacherId = await staffIdFor(inst.institutionId, "teacher");
      const versionId = await createDraftVersion(inst.institutionId, yearId, inst.users.admin.id);
      const date = nextDateForIsodow(1);
      const [slot] = await sql`
        insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
        values (${inst.institutionId}, ${versionId}, ${sectionId}, ${subjectId}, ${teacherId}, 1, ${periodId})
        returning id
      `;
      const substituteId = await createOtherTeacher(inst.institutionId);

      const { error } = await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: slot.id,
        p_date: date,
        p_substitute_id: substituteId,
      });
      expect(error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher calling assign_substitution -> forbidden", async () => {
    const inst = await createTestInstitution("sub-teacher-forbidden");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);

      const { error } = await inst.clientAs("teacher").rpc("assign_substitution", {
        p_slot_id: base.slotId,
        p_date: base.date,
        p_substitute_id: substituteId,
      });
      expect(error?.message).toContain("code:forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin of institution B referencing institution A's slot -> not_found or forbidden", async () => {
    const instA = await createTestInstitution("sub-cross-a");
    const instB = await createTestInstitution("sub-cross-b");
    try {
      const baseA = await buildPublishedSlot(instA);
      const substituteIdB = await createOtherTeacher(instB.institutionId);

      const { error } = await instB.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: baseA.slotId,
        p_date: baseA.date,
        p_substitute_id: substituteIdB,
      });
      expect(error?.message).toMatch(/code:(not_found|forbidden)/);
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("substitute and original teacher see the row; an unrelated teacher and a guardian do not", async () => {
    const inst = await createTestInstitution("sub-scope");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);

      const assign = await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: base.slotId,
        p_date: base.date,
        p_substitute_id: substituteId,
      });
      expect(assign.error).toBeNull();

      // Repoint exam_controller's membership to the substitute's staff row
      // (app.my_staff_ids() reads memberships.staff_id for the caller).
      await sql`
        update public.memberships set staff_id = ${substituteId}
        where institution_id = ${inst.institutionId} and role = 'exam_controller'
      `;

      const substituteView = await inst.clientAs("exam_controller").from("substitutions").select("id");
      expect(substituteView.data).toHaveLength(1);

      const originalView = await inst.clientAs("teacher").from("substitutions").select("id");
      expect(originalView.data).toHaveLength(1);

      const unrelatedTeacherId = await createOtherTeacher(inst.institutionId, "Unrelated Teacher");
      await sql`
        update public.memberships set staff_id = ${unrelatedTeacherId}
        where institution_id = ${inst.institutionId} and role = 'accountant'
      `;
      const unrelatedView = await inst.clientAs("accountant").from("substitutions").select("id");
      expect(unrelatedView.data).toHaveLength(0);

      const guardianView = await inst.clientAs("guardian").from("substitutions").select("id");
      expect(guardianView.data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("cancel -> cancelled, then re-assign succeeds", async () => {
    const inst = await createTestInstitution("sub-cancel-reassign");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);

      const assign = await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: base.slotId,
        p_date: base.date,
        p_substitute_id: substituteId,
      });
      expect(assign.error).toBeNull();

      const cancel = await inst.clientAs("admin").rpc("cancel_substitution", { p_substitution_id: assign.data.id });
      expect(cancel.error).toBeNull();
      expect(cancel.data.status).toBe("cancelled");

      const reassign = await inst.clientAs("admin").rpc("assign_substitution", {
        p_slot_id: base.slotId,
        p_date: base.date,
        p_substitute_id: substituteId,
      });
      expect(reassign.error).toBeNull();
      expect(reassign.data.status).toBe("assigned");

      const [audit] = await sql`
        select action from public.audit_events where entity_id = ${assign.data.id}::uuid and action = 'substitution.cancelled'
      `;
      expect(audit).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });
});
