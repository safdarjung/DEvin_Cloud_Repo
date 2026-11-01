// M07-T5 — src/modules/timetable/queries.ts, called directly as plain
// query functions (not via HTTP; actions.ts isn't built yet, so fixtures
// here write timetable_slots/versions straight via sql / admin RPC, same
// shape as tests/db/api-query-route.test.ts's own local helpers). Mirrors
// tests/db/dashboard-queries.test.ts's buildContext + setActingClient
// pattern for exercising a plain queries.ts function under real RLS.
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
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import {
  timetableConflicts,
  timetableForSection,
  timetableForStudent,
  timetableTeacherWorkload,
  timetableTodayFor,
} from "@/modules/timetable/queries";

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

async function createDraftVersion(
  institutionId: string,
  academicYearId: string,
  createdBy: string,
  overrides: Partial<{ name: string }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.timetable_versions (institution_id, academic_year_id, name, created_by)
    values (${institutionId}, ${academicYearId}, ${overrides.name ?? "Term Timetable"}, ${createdBy})
    returning id
  `;
  return row.id as string;
}

async function createSlot(
  institutionId: string,
  versionId: string,
  classSectionId: string,
  teacherId: string,
  subjectId: string,
  weekday: number,
  periodId: string,
  roomId: string | null = null,
): Promise<string> {
  const [row] = await sql`
    insert into public.timetable_slots (institution_id, version_id, class_section_id, teacher_id, subject_id, room_id, weekday, period_id)
    values (${institutionId}, ${versionId}, ${classSectionId}, ${teacherId}, ${subjectId}, ${roomId}, ${weekday}, ${periodId})
    returning id
  `;
  return row.id as string;
}

describe("timetable queries (M07-T5)", () => {
  it("forSection: an explicit draft versionId sees the draft grid; the default (no versionId) only sees the published one", async () => {
    const inst = await createTestInstitution("tt-q-forsection");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const teacherId = await teacherStaffId(inst.institutionId);
      const subjectId = await createSubject(inst.institutionId, { name: "Mathematics" });
      await createSubjectAssignment(inst.institutionId, sectionId, subjectId, teacherId);
      const roomId = await createRoom(inst.institutionId, { name: "Room 101" });
      const periodId = await createPeriod(inst.institutionId, { seq: 1, name: "Period 1", startsAt: "09:00", endsAt: "09:40" });
      const draftVersion = await createDraftVersion(inst.institutionId, yearId, inst.users.admin.id);
      await createSlot(inst.institutionId, draftVersion, sectionId, teacherId, subjectId, 1, periodId, roomId);

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const draftGrid = await timetableForSection(ctx, sectionId, draftVersion);
        expect(draftGrid).toEqual([
          {
            weekday: 1,
            period: { seq: 1, name: "Period 1", startsAt: "09:00", endsAt: "09:40" },
            subject: { id: subjectId, name: "Mathematics" },
            teacher: { id: teacherId, name: expect.any(String) },
            room: { id: roomId, name: "Room 101" },
          },
        ]);

        const defaultGridBeforePublish = await timetableForSection(ctx, sectionId);
        expect(defaultGridBeforePublish).toEqual([]);
      } finally {
        setActingClient(null);
      }

      const publish = await inst.clientAs("admin").rpc("publish_timetable", { p_version_id: draftVersion });
      expect(publish.error).toBeNull();

      setActingClient(inst.clientAs("admin"));
      try {
        const defaultGridAfterPublish = await timetableForSection(ctx, sectionId);
        expect(defaultGridAfterPublish).toHaveLength(1);
        expect(defaultGridAfterPublish[0].subject).toEqual({ id: subjectId, name: "Mathematics" });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("forStudent: a guardian outside that student's family sees nothing (RLS blocks the enrolment read before any slot lookup)", async () => {
    const inst = await createTestInstitution("tt-q-forstudent");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const [otherStudent] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Other', '2015-01-01', 'other')
        returning id
      `;
      await createEnrolment(inst.institutionId, otherStudent.id, sectionId, yearId, { rollNo: 1 });

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const grid = await timetableForStudent(ctx, otherStudent.id);
        expect(grid).toEqual([]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("todayFor: marks the period containing the mocked clock isCurrent, and the next upcoming one isNext", async () => {
    const inst = await createTestInstitution("tt-q-todayfor");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const teacherId = await teacherStaffId(inst.institutionId);
      const subjectId = await createSubject(inst.institutionId, { name: "Science" });
      await createSubjectAssignment(inst.institutionId, sectionId, subjectId, teacherId);
      const period1 = await createPeriod(inst.institutionId, { seq: 1, name: "Period 1", startsAt: "09:00", endsAt: "09:40" });
      await createPeriod(inst.institutionId, { seq: 2, name: "Short break", startsAt: "09:40", endsAt: "09:50", isBreak: true });
      await createPeriod(inst.institutionId, { seq: 3, name: "Period 2", startsAt: "09:50", endsAt: "10:30" });

      const version = await createDraftVersion(inst.institutionId, yearId, inst.users.admin.id);
      await createSlot(inst.institutionId, version, sectionId, teacherId, subjectId, 1, period1);
      const publish = await inst.clientAs("admin").rpc("publish_timetable", { p_version_id: version });
      expect(publish.error).toBeNull();

      const ctx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher"));
      try {
        // 2026-11-02T03:45:00Z = Mon 09:15 IST (default timezone) — inside period 1.
        vi.setSystemTime(new Date("2026-11-02T03:45:00Z"));
        const duringPeriod1 = await timetableTodayFor(ctx);
        expect(duringPeriod1).toEqual([
          { start: "09:00", end: "09:40", title: "Science", subtitle: expect.any(String), room: undefined, isCurrent: true },
          { start: "09:40", end: "09:50", title: "Short break" },
          { start: "09:50", end: "10:30", title: "Period 2" },
        ]);

        // 2026-11-02T03:20:00Z = Mon 08:50 IST — before period 1 starts.
        vi.setSystemTime(new Date("2026-11-02T03:20:00Z"));
        const beforePeriod1 = await timetableTodayFor(ctx);
        expect(beforePeriod1[0]).toEqual({ start: "09:00", end: "09:40", title: "Science", subtitle: expect.any(String), room: undefined, isNext: true });
      } finally {
        vi.useRealTimers();
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("teacherWorkload counts periods/week per teacher against max_periods", async () => {
    const inst = await createTestInstitution("tt-q-workload");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const teacherId = await teacherStaffId(inst.institutionId);
      const subjectId = await createSubject(inst.institutionId, { name: "Mathematics" });
      const period1 = await createPeriod(inst.institutionId, { seq: 1 });
      const period2 = await createPeriod(inst.institutionId, { seq: 2, startsAt: "09:50", endsAt: "10:30" });
      const version = await createDraftVersion(inst.institutionId, yearId, inst.users.admin.id);
      await createSlot(inst.institutionId, version, sectionId, teacherId, subjectId, 1, period1);
      await createSlot(inst.institutionId, version, sectionId, teacherId, subjectId, 2, period2);

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const workload = await timetableTeacherWorkload(ctx, version);
        expect(workload).toHaveLength(1);
        expect(workload[0].staff_id).toBe(teacherId);
        expect(workload[0].periods_week).toBe(2);
        expect(workload[0].max_periods).toBe(36);
        expect(workload[0].leave_dates).toEqual([]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("conflicts: a room smaller than its section's active strength appears as room_capacity", async () => {
    const inst = await createTestInstitution("tt-q-conflicts");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId);
      const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const teacherId = await teacherStaffId(inst.institutionId);
      const subjectId = await createSubject(inst.institutionId, { name: "Mathematics" });
      const roomId = await createRoom(inst.institutionId, { name: "Tiny Room", capacity: 1 });
      const periodId = await createPeriod(inst.institutionId, { seq: 1 });
      const version = await createDraftVersion(inst.institutionId, yearId, inst.users.admin.id);
      await createSlot(inst.institutionId, version, sectionId, teacherId, subjectId, 1, periodId, roomId);

      const [studentA] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'A', '2015-01-01', 'other') returning id
      `;
      const [studentB] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${inst.institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'B', '2015-01-01', 'other') returning id
      `;
      await createEnrolment(inst.institutionId, studentA.id, sectionId, yearId, { rollNo: 1 });
      await createEnrolment(inst.institutionId, studentB.id, sectionId, yearId, { rollNo: 2 });

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const conflicts = await timetableConflicts(ctx, version);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].kind).toBe("room_capacity");
        expect(conflicts[0].entities).toContain("Tiny Room");
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
