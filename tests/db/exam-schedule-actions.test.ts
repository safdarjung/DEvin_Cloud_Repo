import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (BRIEF-COMMON lesson 13).
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createExam, createExamPapers, schedulePapers } from "@/modules/exams/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubject,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function insertRoom(institutionId: string, name = "Hall A"): Promise<string> {
  const [row] = await sql`insert into public.rooms (institution_id, name, capacity) values (${institutionId}, ${name}, 40) returning id`;
  return row.id as string;
}

/** One exam with two unscheduled papers in one section. */
async function setupExam(institutionId: string) {
  const yearId = await createAcademicYear(institutionId);
  const termId = await createTerm(institutionId, yearId, { sequence: 1 });
  const gradeId = await createGrade(institutionId);
  const sectionId = await createClassSection(institutionId, gradeId, yearId);
  const mathId = await createSubject(institutionId, { code: "MATH", name: "Mathematics" });
  const englishId = await createSubject(institutionId, { code: "ENG", name: "English" });

  return { termId, sectionId, mathId, englishId };
}

describe("M11-T5 exam.paper.schedule", () => {
  it("exam_controller schedules 2 papers; the IST held_on date is derived from scheduledAt", async () => {
    const inst = await createTestInstitution("exam-schedule-basic");
    try {
      const { termId, sectionId, mathId, englishId } = await setupExam(inst.institutionId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "Sched Exam", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");
      const examId = created.data.id;

      const papers = await callAs(inst, "exam_controller", createExamPapers, {
        examId,
        papers: [
          { classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 },
          { classSectionId: sectionId, subjectId: englishId, maxMarks: 80, passMarks: 26.4 },
        ],
      });
      if (!papers.ok) throw new Error("setup failed");

      const paperRows = await sql`select id from public.exam_papers where exam_id = ${examId} order by subject_id`;
      const [paperA, paperB] = paperRows.map((r) => r.id as string);
      const room = await insertRoom(inst.institutionId);

      const result = await callAs(inst, "exam_controller", schedulePapers, {
        examId,
        papers: [
          { paperId: paperA, scheduledAt: "2026-11-09T20:00:00Z", durationMinutes: 90, roomId: room },
          { paperId: paperB, scheduledAt: "2026-11-10T04:00:00Z", durationMinutes: 60 },
        ],
      });
      expect(result).toMatchObject({ ok: true, data: { updated: 2 } });

      const rows = await sql`select id, scheduled_at, duration_minutes, room_id, held_on::text as held_on from public.exam_papers where exam_id = ${examId} order by id`;
      const rowA = rows.find((r) => r.id === paperA);
      expect(rowA?.held_on).toBe("2026-11-10"); // 2026-11-09T20:00Z = 01:30 IST next day
      expect(rowA?.room_id).toBe(room);
      expect(rowA?.duration_minutes).toBe(90);
    } finally {
      await inst.cleanup();
    }
  });

  it("scheduledAt: null clears duration/room and keeps held_on", async () => {
    const inst = await createTestInstitution("exam-schedule-clear");
    try {
      const { termId, sectionId, mathId } = await setupExam(inst.institutionId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "Clear Exam", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");
      const examId = created.data.id;
      const papers = await callAs(inst, "exam_controller", createExamPapers, {
        examId,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });
      if (!papers.ok) throw new Error("setup failed");
      const [paperRow] = await sql`select id from public.exam_papers where exam_id = ${examId}`;
      const paperId = paperRow.id as string;
      const room = await insertRoom(inst.institutionId);

      await callAs(inst, "exam_controller", schedulePapers, {
        examId,
        papers: [{ paperId, scheduledAt: "2026-11-09T20:00:00Z", durationMinutes: 90, roomId: room }],
      });
      const [before] = await sql`select held_on from public.exam_papers where id = ${paperId}`;

      const cleared = await callAs(inst, "exam_controller", schedulePapers, {
        examId,
        papers: [{ paperId, scheduledAt: null }],
      });
      expect(cleared).toMatchObject({ ok: true, data: { updated: 1 } });

      const [after] = await sql`select scheduled_at, duration_minutes, room_id, held_on from public.exam_papers where id = ${paperId}`;
      expect(after.scheduled_at).toBeNull();
      expect(after.duration_minutes).toBeNull();
      expect(after.room_id).toBeNull();
      expect(String(after.held_on)).toBe(String(before.held_on));
    } finally {
      await inst.cleanup();
    }
  });

  it("a published exam cannot be rescheduled (invalid_state)", async () => {
    const inst = await createTestInstitution("exam-schedule-published");
    try {
      const { termId, sectionId, mathId } = await setupExam(inst.institutionId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "Pub Exam", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");
      const examId = created.data.id;
      const papers = await callAs(inst, "exam_controller", createExamPapers, {
        examId,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });
      if (!papers.ok) throw new Error("setup failed");
      const [paperRow] = await sql`select id from public.exam_papers where exam_id = ${examId}`;

      await sql`update public.exams set status = 'published', published_at = now() where id = ${examId}`;

      const result = await callAs(inst, "exam_controller", schedulePapers, {
        examId,
        papers: [{ paperId: paperRow.id as string, scheduledAt: "2026-11-09T20:00:00Z", durationMinutes: 60 }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("a paper belonging to a different exam is not_found", async () => {
    const inst = await createTestInstitution("exam-schedule-wrong-exam");
    try {
      const { termId, sectionId, mathId, englishId } = await setupExam(inst.institutionId);
      const examA = await callAs(inst, "exam_controller", createExam, { termId, name: "Exam A", type: "unit_test" });
      const examB = await callAs(inst, "exam_controller", createExam, { termId, name: "Exam B", type: "unit_test" });
      if (!examA.ok || !examB.ok) throw new Error("setup failed");
      await callAs(inst, "exam_controller", createExamPapers, {
        examId: examA.data.id,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });
      await callAs(inst, "exam_controller", createExamPapers, {
        examId: examB.data.id,
        papers: [{ classSectionId: sectionId, subjectId: englishId, maxMarks: 80, passMarks: 26.4 }],
      });
      const [paperOfB] = await sql`select id from public.exam_papers where exam_id = ${examB.data.id}`;

      const result = await callAs(inst, "exam_controller", schedulePapers, {
        examId: examA.data.id,
        papers: [{ paperId: paperOfB.id as string, scheduledAt: "2026-11-09T20:00:00Z", durationMinutes: 60 }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("a room from another institution is validation_failed", async () => {
    const inst = await createTestInstitution("exam-schedule-cross-room");
    const instB = await createTestInstitution("exam-schedule-cross-room-b");
    try {
      const { termId, sectionId, mathId } = await setupExam(inst.institutionId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "Cross Room", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");
      const papers = await callAs(inst, "exam_controller", createExamPapers, {
        examId: created.data.id,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });
      if (!papers.ok) throw new Error("setup failed");
      const [paperRow] = await sql`select id from public.exam_papers where exam_id = ${created.data.id}`;
      const roomB = await insertRoom(instB.institutionId, "Other Inst Room");

      const result = await callAs(inst, "exam_controller", schedulePapers, {
        examId: created.data.id,
        papers: [{ paperId: paperRow.id as string, scheduledAt: "2026-11-09T20:00:00Z", durationMinutes: 60, roomId: roomB }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    } finally {
      await inst.cleanup();
      await instB.cleanup();
    }
  });

  it("a teacher is forbidden (no exam.manage)", async () => {
    const inst = await createTestInstitution("exam-schedule-teacher-forbidden");
    try {
      const { termId, sectionId, mathId } = await setupExam(inst.institutionId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "Teacher Forbidden", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");
      const papers = await callAs(inst, "exam_controller", createExamPapers, {
        examId: created.data.id,
        papers: [{ classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 }],
      });
      if (!papers.ok) throw new Error("setup failed");
      const [paperRow] = await sql`select id from public.exam_papers where exam_id = ${created.data.id}`;

      const result = await callAs(inst, "teacher", schedulePapers, {
        examId: created.data.id,
        papers: [{ paperId: paperRow.id as string, scheduledAt: "2026-11-09T20:00:00Z", durationMinutes: 60 }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("two overlapping papers of one section are accepted — scheduling is not a constraint", async () => {
    const inst = await createTestInstitution("exam-schedule-overlap-ok");
    try {
      const { termId, sectionId, mathId, englishId } = await setupExam(inst.institutionId);
      const created = await callAs(inst, "exam_controller", createExam, { termId, name: "Overlap OK", type: "unit_test" });
      if (!created.ok) throw new Error("setup failed");
      const papers = await callAs(inst, "exam_controller", createExamPapers, {
        examId: created.data.id,
        papers: [
          { classSectionId: sectionId, subjectId: mathId, maxMarks: 80, passMarks: 26.4 },
          { classSectionId: sectionId, subjectId: englishId, maxMarks: 80, passMarks: 26.4 },
        ],
      });
      if (!papers.ok) throw new Error("setup failed");
      const rows = await sql`select id from public.exam_papers where exam_id = ${created.data.id} order by id`;
      const [paperA, paperB] = rows.map((r) => r.id as string);

      const result = await callAs(inst, "exam_controller", schedulePapers, {
        examId: created.data.id,
        papers: [
          { paperId: paperA, scheduledAt: "2026-11-09T09:00:00+05:30", durationMinutes: 90 },
          { paperId: paperB, scheduledAt: "2026-11-09T09:30:00+05:30", durationMinutes: 90 },
        ],
      });
      expect(result).toMatchObject({ ok: true, data: { updated: 2 } });
    } finally {
      await inst.cleanup();
    }
  });
});
