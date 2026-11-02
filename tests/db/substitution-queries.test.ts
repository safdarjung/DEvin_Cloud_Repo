// M08-T12 — src/modules/timetable/substitution.queries.ts, called directly as
// plain query functions (not via HTTP), mirrors tests/db/timetable-queries.
// test.ts's buildContext + setActingClient pattern, and reuses
// tests/db/substitutions-rls.test.ts's buildPublishedSlot/createOtherTeacher
// fixture shape.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade, createSubject } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { timetableCoverNeeded, timetableSubstitutionCandidates, timetableSubstitutions } from "@/modules/timetable/substitution.queries";
import { timetableTeacherWorkload } from "@/modules/timetable/queries";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

async function staffIdFor(institutionId: string, role: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
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

async function publishVersion(versionId: string, adminUserId: string): Promise<void> {
  await sql`update public.timetable_versions set status = 'published', published_at = now(), published_by = ${adminUserId} where id = ${versionId}`;
}

/** Next date (today or later) whose ISO weekday (1=Mon..6=Sat) is `isodow`. */
function nextDateForIsodow(isodow: number, minDaysAhead = 3): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  const currentIsodow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((isodow - currentIsodow + 7) % 7));
  return d.toISOString().slice(0, 10);
}

async function approveLeave(institutionId: string, staffId: string, date: string, adminUserId: string): Promise<string> {
  const [row] = await sql`
    insert into public.leave_requests (institution_id, staff_id, leave_type, start_date, end_date, reason, status, created_by, decided_by, decided_at)
    values (${institutionId}, ${staffId}, 'sick', ${date}, ${date}, 'Sick', 'approved', ${adminUserId}, ${adminUserId}, now())
    returning id
  `;
  return row.id as string;
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
  await publishVersion(versionId, inst.users.admin.id);

  return { yearId, sectionId, subjectId, periodId, teacherId, versionId, slotId: slot.id as string, weekday, date };
}

describe("substitution queries (M08-T12)", () => {
  it("coverNeeded lists a teacher-on-leave slot with substitution null, candidates exclude busy/on-leave teachers, assigning fills coverNeeded, and substitutions is scoped to the original/substitute teacher", async () => {
    const inst = await createTestInstitution("sub-q-flow");
    try {
      const base = await buildPublishedSlot(inst);
      await approveLeave(inst.institutionId, base.teacherId, base.date, inst.users.admin.id);
      let substituteId = "";

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const before = await timetableCoverNeeded(ctx, base.date);
        expect(before).toHaveLength(1);
        expect(before[0]).toMatchObject({
          slotId: base.slotId,
          date: base.date,
          section: { id: base.sectionId },
          teacher: { id: base.teacherId },
          reason: "leave",
          substitution: null,
        });

        // A free substitute, a teacher busy at that weekday/period elsewhere,
        // and a teacher who is themself on approved leave that date.
        substituteId = await createOtherTeacher(inst.institutionId, "Free Sub");
        const busyTeacherId = await createOtherTeacher(inst.institutionId, "Busy Teacher");
        const onLeaveTeacherId = await createOtherTeacher(inst.institutionId, "On Leave Teacher");
        const otherSectionId = await createClassSection(inst.institutionId, await createGrade(inst.institutionId, { code: "VII", sortKey: 7 }), base.yearId, { name: "B" });
        await sql`
          insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
          values (${inst.institutionId}, ${base.versionId}, ${otherSectionId}, ${base.subjectId}, ${busyTeacherId}, ${base.weekday}, ${base.periodId})
        `;
        await approveLeave(inst.institutionId, onLeaveTeacherId, base.date, inst.users.admin.id);

        const candidates = await timetableSubstitutionCandidates(ctx, base.slotId, base.date);
        const candidateIds = candidates.map((c) => c.staffId);
        expect(candidateIds).toContain(substituteId);
        expect(candidateIds).not.toContain(busyTeacherId);
        expect(candidateIds).not.toContain(onLeaveTeacherId);
        expect(candidateIds).not.toContain(base.teacherId);

        const assign = await inst.clientAs("admin").rpc("assign_substitution", {
          p_slot_id: base.slotId,
          p_date: base.date,
          p_substitute_id: substituteId,
        });
        expect(assign.error).toBeNull();

        const after = await timetableCoverNeeded(ctx, base.date);
        expect(after[0].substitution).toMatchObject({ substituteId });

        const directRead = await timetableSubstitutions(ctx, base.date);
        expect(directRead).toHaveLength(1);
        expect(directRead[0]).toMatchObject({
          originalTeacher: { id: base.teacherId },
          substituteTeacher: { id: substituteId },
          status: "assigned",
        });
      } finally {
        setActingClient(null);
      }

      // Repoint exam_controller's membership to the substitute's own staff
      // row (app.my_staff_ids() reads memberships.staff_id for the caller).
      await sql`update public.memberships set staff_id = ${substituteId} where institution_id = ${inst.institutionId} and role = 'exam_controller'`;
      const subCtx = await buildContext(inst, "exam_controller");
      setActingClient(inst.clientAs("exam_controller"));
      try {
        const subView = await timetableSubstitutions(subCtx, base.date);
        expect(subView).toHaveLength(1);
      } finally {
        setActingClient(null);
      }

      const unrelatedTeacherId = await createOtherTeacher(inst.institutionId, "Unrelated Teacher");
      await sql`update public.memberships set staff_id = ${unrelatedTeacherId} where institution_id = ${inst.institutionId} and role = 'accountant'`;
      const unrelatedCtx = await buildContext(inst, "accountant");
      setActingClient(inst.clientAs("accountant"));
      try {
        const unrelatedView = await timetableSubstitutions(unrelatedCtx, base.date);
        expect(unrelatedView).toEqual([]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("teacherWorkload leave_dates lists the staff member's approved leave dates in today..today+13", async () => {
    const inst = await createTestInstitution("sub-q-workload-leave");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const subjectId = await createSubject(inst.institutionId);
      const periodId = await createPeriod(inst.institutionId, 1);
      const teacherId = await staffIdFor(inst.institutionId, "teacher");
      const version = await createDraftVersion(inst.institutionId, yearId, inst.users.admin.id);
      await sql`
        insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, weekday, period_id)
        values (${inst.institutionId}, ${version}, ${sectionId}, ${subjectId}, ${teacherId}, 1, ${periodId})
      `;
      const today = todayIso();
      await approveLeave(inst.institutionId, teacherId, today, inst.users.admin.id);

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const workload = await timetableTeacherWorkload(ctx, version);
        expect(workload).toHaveLength(1);
        expect(workload[0].leave_dates).toEqual([today]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
