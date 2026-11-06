// M25-T8 — timetable.suggest, exercised as the registered defineQuery
// (callAs), same shape as tests/db/exam-schedule-queries.test.ts. Factory
// helpers (createRoom, createPeriod, createDraftVersion, createSlot) mirror
// tests/db/timetable-queries.test.ts's fixture pattern.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubject,
  createSubjectAssignment,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { saveDraft } from "@/modules/timetable/actions";
import { timetableSuggestQuery } from "@/modules/timetable/query-defs";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

async function createRoom(institutionId: string, name: string): Promise<string> {
  const [row] = await sql`insert into public.rooms (institution_id, name, capacity) values (${institutionId}, ${name}, 30) returning id`;
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

async function createDraftVersion(institutionId: string, academicYearId: string, createdBy: string): Promise<string> {
  const [row] = await sql`
    insert into public.timetable_versions (institution_id, academic_year_id, name, created_by)
    values (${institutionId}, ${academicYearId}, 'Term Timetable', ${createdBy})
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

async function slotCount(versionId: string): Promise<number> {
  const [row] = await sql`select count(*)::int as n from public.timetable_slots where version_id = ${versionId}`;
  return row.n as number;
}

describe("timetable.suggest (M25-T8)", () => {
  it("fills empty cells without touching timetable_slots, and every suggested slot saves cleanly via saveDraft", async () => {
    const inst = await createTestInstitution("tt-suggest-fill");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId, { code: "VI" });
      const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
      const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });
      const teacherId = await teacherStaffId(inst.institutionId);
      const mathsId = await createSubject(inst.institutionId, { name: "Mathematics" });
      const scienceId = await createSubject(inst.institutionId, { name: "Science" });
      await createSubjectAssignment(inst.institutionId, sectionA, mathsId, teacherId);
      await createSubjectAssignment(inst.institutionId, sectionA, scienceId, teacherId);
      await createSubjectAssignment(inst.institutionId, sectionB, mathsId, teacherId);
      const roomId = await createRoom(inst.institutionId, "Room 101");
      const period1 = await createPeriod(inst.institutionId, { seq: 1 });
      await createPeriod(inst.institutionId, { seq: 2 });
      await createPeriod(inst.institutionId, { seq: 3, isBreak: true }); // break period — never a cell
      const versionId = await createDraftVersion(inst.institutionId, yearId, inst.users.admin.id);
      await createSlot(inst.institutionId, versionId, sectionA, teacherId, mathsId, 1, period1, roomId);

      const before = await slotCount(versionId);
      const res = await callAs(inst, "admin", timetableSuggestQuery, { versionId });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.versionId).toBe(versionId);
      expect(res.data.engineVersion).toBe(1);
      expect(res.data.truncated).toBe(false);
      expect(res.data.suggestions.length).toBeGreaterThan(0);
      // 2 sections x 2 teaching periods x 6 weekdays, minus the 1 existing slot.
      const emptyCellsBeforePass = 2 * 2 * 6 - 1;
      expect(res.data.unfilled).toBe(emptyCellsBeforePass - res.data.suggestions.length);

      // The suggest call itself never writes.
      expect(await slotCount(versionId)).toBe(before);

      const saved = await callAs(inst, "admin", saveDraft, {
        versionId,
        slots: res.data.suggestions.map((s) => s.slot),
      });
      expect(saved.ok).toBe(true);
      expect(await slotCount(versionId)).toBe(before + res.data.suggestions.length);
    } finally {
      await inst.cleanup();
    }
  });

  it("published version -> invalid_state; unknown version -> not_found; teacher -> forbidden", async () => {
    const inst = await createTestInstitution("tt-suggest-state");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const versionId = await createDraftVersion(inst.institutionId, yearId, inst.users.admin.id);

      const unknown = await callAs(inst, "admin", timetableSuggestQuery, { versionId: crypto.randomUUID() });
      expect(unknown).toEqual({ ok: false, error: { code: "not_found", message: expect.any(String) } });

      const forbidden = await callAs(inst, "teacher", timetableSuggestQuery, { versionId });
      expect(forbidden.ok).toBe(false);
      if (!forbidden.ok) expect(forbidden.error.code).toBe("forbidden");

      const publish = await inst.clientAs("admin").rpc("publish_timetable", { p_version_id: versionId });
      expect(publish.error).toBeNull();

      const published = await callAs(inst, "admin", timetableSuggestQuery, { versionId });
      expect(published.ok).toBe(false);
      if (!published.ok) expect(published.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("pages past PostgREST's 1,000-row default: 1,007 slots -> exactly 1 suggestion, for the one removed cell", async () => {
    const inst = await createTestInstitution("tt-suggest-paging");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const gradeId = await createGrade(inst.institutionId, { code: "VI" });

      const SECTION_COUNT = 21;
      const SUBJECT_COUNT = 4;
      const PERIODS_PER_DAY = 8; // 2 per subject/day x 4 subjects
      const WEEKDAYS = [1, 2, 3, 4, 5, 6];

      const sectionIds: string[] = [];
      for (let i = 0; i < SECTION_COUNT; i++) {
        sectionIds.push(await createClassSection(inst.institutionId, gradeId, yearId, { name: `S${i + 1}` }));
      }
      const subjectIds: string[] = [];
      for (let s = 0; s < SUBJECT_COUNT; s++) {
        subjectIds.push(await createSubject(inst.institutionId, { name: `Subject-${s + 1}` }));
      }
      const periodIdBySeq = new Map<number, string>();
      for (let seq = 1; seq <= PERIODS_PER_DAY; seq++) {
        periodIdBySeq.set(seq, await createPeriod(inst.institutionId, { seq }));
      }

      // One dedicated teacher per (section, subject) pair — 84 teachers,
      // each with exactly 2 periods/day for their own subject in their own
      // section, so no teacher/room contention is possible.
      const teacherIdBySectionSubject = new Map<string, string>();
      for (let i = 0; i < SECTION_COUNT; i++) {
        for (let s = 0; s < SUBJECT_COUNT; s++) {
          const [staffRow] = await sql`
            insert into public.staff (institution_id, employee_no, full_name, designation, is_teaching)
            values (${inst.institutionId}, ${`EMP-SUG-${i}-${s}-${crypto.randomUUID().slice(0, 6)}`}, ${`Teacher ${i}-${s}`}, 'Teacher', true)
            returning id
          `;
          teacherIdBySectionSubject.set(`${i}|${s}`, staffRow.id as string);
          await createSubjectAssignment(inst.institutionId, sectionIds[i], subjectIds[s], staffRow.id as string);
        }
      }

      const versionId = await createDraftVersion(inst.institutionId, yearId, inst.users.admin.id);

      const rows: {
        institution_id: string;
        version_id: string;
        class_section_id: string;
        teacher_id: string;
        subject_id: string;
        room_id: null;
        weekday: number;
        period_id: string;
      }[] = [];
      for (let i = 0; i < SECTION_COUNT; i++) {
        for (let s = 0; s < SUBJECT_COUNT; s++) {
          const teacherId = teacherIdBySectionSubject.get(`${i}|${s}`)!;
          for (const weekday of WEEKDAYS) {
            for (const offset of [0, 1]) {
              if (i === 0 && s === 0 && weekday === 1 && offset === 0) continue; // the one removed cell
              rows.push({
                institution_id: inst.institutionId,
                version_id: versionId,
                class_section_id: sectionIds[i],
                teacher_id: teacherId,
                subject_id: subjectIds[s],
                room_id: null,
                weekday,
                period_id: periodIdBySeq.get(2 * s + offset + 1)!,
              });
            }
          }
        }
      }
      expect(rows.length).toBe(1007);
      // Bulk-inserted direct via the service-role-level connection (postgres.js's
      // sql(array) multi-row insert) — 1,008 individual action calls would be
      // needlessly slow for a fixture whose point is the row count, not the writes.
      await sql`insert into public.timetable_slots ${sql(rows)}`;

      const res = await callAs(inst, "admin", timetableSuggestQuery, { versionId });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.truncated).toBe(false);
      expect(res.data.suggestions).toHaveLength(1);
      const [suggestion] = res.data.suggestions;
      expect(suggestion.slot).toEqual({
        classSectionId: sectionIds[0],
        weekday: 1,
        periodId: periodIdBySeq.get(1),
        subjectId: subjectIds[0],
        teacherId: teacherIdBySectionSubject.get("0|0"),
      });
    } finally {
      await inst.cleanup();
    }
  });
});
