// M11-T7 — exams.schedule / exams.scheduleConflicts, exercised as the
// registered defineQuery actions (callAs), same shape as
// tests/db/exams-actions.test.ts. Fixtures write exam_papers'
// scheduled_at/duration_minutes/room_id directly via sql (T5's
// exam.paper.schedule action isn't built yet — out of scope here) and
// drive createExam/createExamPapers for the rest, mirroring that file's
// setupFixture.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createExam, createExamPapers } from "@/modules/exams/actions";
import { examScheduleConflictsQuery, examScheduleQuery } from "@/modules/exams/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

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
  overrides: Partial<{ seq: number; startsAt: string; endsAt: string }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.periods (institution_id, seq, name, starts_at, ends_at, is_break)
    values (${institutionId}, ${overrides.seq ?? 1}, 'Period 1', ${overrides.startsAt ?? "09:00"}, ${overrides.endsAt ?? "09:40"}, false)
    returning id
  `;
  return row.id as string;
}

/** Publishes a one-slot Monday timetable for `sectionId` in `roomId` at 09:00-09:40. */
async function publishMondaySlot(
  inst: TestInstitution,
  yearId: string,
  sectionId: string,
  subjectId: string,
  teacherId: string,
  roomId: string,
): Promise<void> {
  const periodId = await createPeriod(inst.institutionId);
  const [version] = await sql`
    insert into public.timetable_versions (institution_id, academic_year_id, name, created_by)
    values (${inst.institutionId}, ${yearId}, 'Term Timetable', ${inst.users.admin.id})
    returning id
  `;
  await sql`
    insert into public.timetable_slots (institution_id, version_id, class_section_id, teacher_id, subject_id, room_id, weekday, period_id)
    values (${inst.institutionId}, ${version.id}, ${sectionId}, ${teacherId}, ${subjectId}, ${roomId}, 1, ${periodId})
  `;
  const publish = await inst.clientAs("admin").rpc("publish_timetable", { p_version_id: version.id });
  if (publish.error) throw publish.error;
}

async function scheduleExisting(
  paperId: string,
  scheduledAt: string | null,
  durationMinutes: number | null,
  roomId: string | null,
  heldOn: string,
): Promise<void> {
  await sql`
    update public.exam_papers
    set scheduled_at = ${scheduledAt}, duration_minutes = ${durationMinutes}, room_id = ${roomId}, held_on = ${heldOn}
    where id = ${paperId}
  `;
}

async function setExamStatus(examId: string, status: string): Promise<void> {
  await sql`update public.exams set status = ${status} where id = ${examId}`;
}

async function fixture(institutionId: string) {
  const teacherId = await teacherStaffId(institutionId);
  const yearId = await createAcademicYear(institutionId);
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId);
  const sectionId = await createClassSection(institutionId, gradeId, yearId);
  const mathId = await createSubject(institutionId, { code: "MATH", name: "Mathematics" });
  const englishId = await createSubject(institutionId, { code: "ENG", name: "English" });
  await createSubjectAssignment(institutionId, sectionId, mathId, teacherId);
  await createSubjectAssignment(institutionId, sectionId, englishId, teacherId);
  const studentA = (
    await sql`insert into public.students (institution_id, admission_no, first_name, dob, gender) values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'A', '2014-01-01', 'other') returning id`
  )[0].id as string;
  await createEnrolment(institutionId, studentA, sectionId, yearId);
  return { teacherId, yearId, termId, gradeId, sectionId, mathId, englishId };
}

describe("exams.schedule / exams.scheduleConflicts (M11-T7)", () => {
  it("schedule maps status/kind per the rulings, honours from/to, and is empty for a guardian (staff-only RLS)", async () => {
    const inst = await createTestInstitution("exam-sched-q-schedule");
    try {
      const { sectionId, mathId, termId } = await fixture(inst.institutionId);

      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "Unit Test 1", type: "unit_test" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const examId = created.data.id;

      const papers = await callAs(inst, "exam_controller", createExamPapers, {
        examId,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });
      expect(papers.ok).toBe(true);
      const [{ id: paperId }] = await sql`select id from public.exam_papers where exam_id = ${examId}`;

      // draft + scheduled_at -> "scheduled"; 2026-11-09T20:00:00Z is Mon 2026-11-10 in IST.
      await scheduleExisting(paperId, "2026-11-09T20:00:00Z", 90, null, "2026-11-10");

      const scheduled = await callAs(inst, "exam_controller", examScheduleQuery, {});
      expect(scheduled.ok).toBe(true);
      if (!scheduled.ok) return;
      expect(scheduled.data).toHaveLength(1);
      expect(scheduled.data[0]).toMatchObject({
        id: paperId,
        exam_id: examId,
        kind: "unit_test",
        status: "scheduled",
        date: "2026-11-10",
        section_label: expect.stringContaining("-"),
      });

      await setExamStatus(examId, "marks_entry");
      const marked = await callAs(inst, "exam_controller", examScheduleQuery, {});
      if (!marked.ok) return;
      expect(marked.data[0].status).toBe("marked");

      await setExamStatus(examId, "published");
      const published = await callAs(inst, "exam_controller", examScheduleQuery, {});
      if (!published.ok) return;
      expect(published.data[0].status).toBe("published");

      // from/to filter excludes it once the window no longer covers 2026-11-10.
      const filteredOut = await callAs(inst, "exam_controller", examScheduleQuery, { from: "2026-12-01" });
      if (!filteredOut.ok) return;
      expect(filteredOut.data).toEqual([]);
      const filteredIn = await callAs(inst, "exam_controller", examScheduleQuery, { from: "2026-11-01", to: "2026-11-30" });
      if (!filteredIn.ok) return;
      expect(filteredIn.data).toHaveLength(1);

      const guardianRead = await callAs(inst, "guardian", examScheduleQuery, {});
      expect(guardianRead).toMatchObject({ ok: true, data: [] });
    } finally {
      await inst.cleanup();
    }
  });

  it("half_yearly maps to term_exam", async () => {
    const inst = await createTestInstitution("exam-sched-q-kind");
    try {
      const { sectionId, mathId, termId } = await fixture(inst.institutionId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "Half Yearly", type: "half_yearly" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await callAs(inst, "exam_controller", createExamPapers, {
        examId: created.data.id,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });
      const [{ id: paperId }] = await sql`select id from public.exam_papers where exam_id = ${created.data.id}`;
      await scheduleExisting(paperId, null, null, null, "2026-11-10");

      const result = await callAs(inst, "exam_controller", examScheduleQuery, {});
      if (!result.ok) return;
      expect(result.data[0]).toMatchObject({ kind: "term_exam", status: "planned" });
    } finally {
      await inst.cleanup();
    }
  });

  it("scheduleConflicts: a room the published timetable uses -> room_timetable_clash; two overlapping papers of one section -> section_double_booked; a teacher is forbidden", async () => {
    const inst = await createTestInstitution("exam-sched-q-conflicts");
    try {
      const { sectionId, mathId, englishId, termId, yearId, teacherId } = await fixture(inst.institutionId);
      const roomId = await createRoom(inst.institutionId, "Hall 1");
      await publishMondaySlot(inst, yearId, sectionId, mathId, teacherId, roomId);

      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "PT Conflicts", type: "unit_test" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const examId = created.data.id;
      await callAs(inst, "exam_controller", createExamPapers, {
        examId,
        papers: [
          { classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 },
          { classSectionId: sectionId, subjectId: englishId, maxMarks: 80, passMarks: 26.4 },
        ],
      });
      const paperRows = await sql`select id, subject_id from public.exam_papers where exam_id = ${examId}`;
      const mathPaper = paperRows.find((r) => r.subject_id === mathId)!.id as string;
      const englishPaper = paperRows.find((r) => r.subject_id === englishId)!.id as string;

      // Mon 2026-11-02 09:30 IST (04:00Z), in the room the published timetable
      // uses Mon 09:00-09:40 -> room_timetable_clash. englishPaper overlaps it
      // (09:40 IST start) on the same section -> section_double_booked.
      await scheduleExisting(mathPaper, "2026-11-02T04:00:00Z", 40, roomId, "2026-11-02");
      await scheduleExisting(englishPaper, "2026-11-02T04:10:00Z", 40, null, "2026-11-02");

      const conflicts = await callAs(inst, "exam_controller", examScheduleConflictsQuery, { examId });
      expect(conflicts.ok).toBe(true);
      if (!conflicts.ok) return;
      expect(conflicts.data.some((c) => c.kind === "room_timetable_clash" && c.exam_paper_id === mathPaper)).toBe(true);
      expect(
        conflicts.data.some(
          (c) =>
            c.kind === "section_double_booked" &&
            [c.exam_paper_id, c.other_exam_paper_id].includes(mathPaper) &&
            [c.exam_paper_id, c.other_exam_paper_id].includes(englishPaper),
        ),
      ).toBe(true);

      const asTeacher = await callAs(inst, "teacher", examScheduleConflictsQuery, { examId });
      expect(asTeacher).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });
});
