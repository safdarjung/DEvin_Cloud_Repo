import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { assignSubstitution, cancelSubstitution } from "@/modules/timetable/substitution.actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { createAcademicYear, createClassSection, createGrade, createSubject, closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// M08-T9 — timetable.substitution.assign / .cancel over defineAction. The
// RPCs themselves (assign_substitution/cancel_substitution) are exercised at
// the SQL layer in tests/db/substitutions-rls.test.ts; this file proves the
// action's permission gate and its 23505 -> conflict (fieldErrors.substituteId)
// mapping.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
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

describe("timetable.substitution.assign / timetable.substitution.cancel (M08-T9)", () => {
  it("admin assigns a free teacher -> ok", async () => {
    const inst = await createTestInstitution("sub-action-assign");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);

      const result = await callAs(inst, "admin", assignSubstitution, {
        slotId: base.slotId,
        date: base.date,
        substituteId,
        note: "Teacher is on leave",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe("assigned");
      expect(result.data.substituteTeacherId).toBe(substituteId);
      expect(result.data.originalTeacherId).toBe(base.teacherId);
    } finally {
      await inst.cleanup();
    }
  });

  it("double-booked substitute -> conflict naming substituteId", async () => {
    const inst = await createTestInstitution("sub-action-conflict");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);
      const otherTeacherId = await createOtherTeacher(inst.institutionId, "Second Teacher");
      const otherSectionId = await createClassSection(
        inst.institutionId,
        await createGrade(inst.institutionId, { code: "VII", sortKey: 7 }),
        base.yearId,
        { name: "B" },
      );
      const [otherSlot] = await sql`
        insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
        values (${inst.institutionId}, ${base.versionId}, ${otherSectionId}, ${base.subjectId}, ${otherTeacherId}, ${base.weekday}, ${base.periodId})
        returning id
      `;

      const first = await callAs(inst, "admin", assignSubstitution, { slotId: base.slotId, date: base.date, substituteId, note: "Teacher is on leave" });
      expect(first.ok).toBe(true);

      const second = await callAs(inst, "admin", assignSubstitution, { slotId: otherSlot.id as string, date: base.date, substituteId, note: "Teacher is on leave" });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("conflict");
      expect(second.error.fieldErrors?.substituteId).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher calling assign -> forbidden", async () => {
    const inst = await createTestInstitution("sub-action-forbidden");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);

      const result = await callAs(inst, "teacher", assignSubstitution, { slotId: base.slotId, date: base.date, substituteId, note: "Teacher is on leave" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("cancel then cancel again -> invalid_state", async () => {
    const inst = await createTestInstitution("sub-action-cancel-twice");
    try {
      const base = await buildPublishedSlot(inst);
      const substituteId = await createOtherTeacher(inst.institutionId);

      const assigned = await callAs(inst, "admin", assignSubstitution, { slotId: base.slotId, date: base.date, substituteId, note: "Teacher is on leave" });
      expect(assigned.ok).toBe(true);
      if (!assigned.ok) return;

      const firstCancel = await callAs(inst, "admin", cancelSubstitution, { substitutionId: assigned.data.id });
      expect(firstCancel.ok).toBe(true);
      if (!firstCancel.ok) return;
      expect(firstCancel.data.status).toBe("cancelled");

      const secondCancel = await callAs(inst, "admin", cancelSubstitution, { substitutionId: assigned.data.id });
      expect(secondCancel.ok).toBe(false);
      if (secondCancel.ok) return;
      expect(secondCancel.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });
});
