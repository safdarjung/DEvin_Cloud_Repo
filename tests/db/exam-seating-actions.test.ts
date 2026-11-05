// X06-T5 — action `examSeating.generate` (thin RPC wrapper over T3's
// generate_seating_plan; this file is the TS-boundary test — module gate,
// permission gate, and ErrorCode mapping. Generator logic itself is T3's
// tests/db/exam-seating-generate.test.ts).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { generateSeatingPlan } from "@/modules/exam-seating/actions";
import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
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

const FUTURE_SLOT = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const PAST_SLOT = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2014-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function createRoom(institutionId: string, overrides: Partial<{ name: string; capacity: number }> = {}): Promise<string> {
  const [row] = await sql`
    insert into public.rooms (institution_id, name, capacity)
    values (${institutionId}, ${overrides.name ?? `Room-${crypto.randomUUID().slice(0, 6)}`}, ${overrides.capacity ?? 30})
    returning id
  `;
  return row.id as string;
}

async function createExam(institutionId: string, termId: string): Promise<string> {
  const [row] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status)
    values (
      ${institutionId},
      (select academic_year_id from public.terms where id = ${termId}),
      ${termId},
      ${`Exam-${crypto.randomUUID().slice(0, 8)}`},
      'unit_test',
      'draft'
    )
    returning id
  `;
  return row.id as string;
}

async function insertExamPaper(
  institutionId: string,
  examId: string,
  classSectionId: string,
  subjectId: string,
  scheduledAt: string,
): Promise<string> {
  const [row] = await sql`
    insert into public.exam_papers (institution_id, exam_id, class_section_id, subject_id, max_marks, pass_marks, scheduled_at, duration_minutes)
    values (${institutionId}, ${examId}, ${classSectionId}, ${subjectId}, 100, 33, ${scheduledAt}, 60)
    returning id
  `;
  return row.id as string;
}

/** One section of `studentCount` active students enrolled for an exam paper at `slotStart`. */
async function seedSection(
  institutionId: string,
  gradeId: string,
  yearId: string,
  examId: string,
  subjectId: string,
  slotStart: string,
  studentCount: number,
): Promise<string> {
  const sectionId = await createClassSection(institutionId, gradeId, yearId);
  await insertExamPaper(institutionId, examId, sectionId, subjectId, slotStart);
  for (let i = 1; i <= studentCount; i++) {
    const studentId = await insertStudent(institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
    await createEnrolment(institutionId, studentId, sectionId, yearId, { rollNo: i });
  }
  return sectionId;
}

// demo_reset-style self-FK cleanup (T3's exam-seating-generate.test.ts) —
// clear this module's own rows before `inst.cleanup()` to avoid colliding
// with a left-behind superseded version's `superseded_by`.
async function cleanupSeatingFixture(institutionId: string): Promise<void> {
  await sql`delete from public.exam_seats where institution_id = ${institutionId}`;
  await sql`delete from public.exam_seating_plans where institution_id = ${institutionId} and superseded_by is not null`;
  await sql`delete from public.exam_seating_plans where institution_id = ${institutionId}`;
}

async function setupFixture(institutionId: string, studentCount = 3) {
  const yearId = await createAcademicYear(institutionId);
  const termId = await createTerm(institutionId, yearId);
  const subjectId = await createSubject(institutionId);
  const gradeId = await createGrade(institutionId);
  const examId = await createExam(institutionId, termId);
  await seedSection(institutionId, gradeId, yearId, examId, subjectId, FUTURE_SLOT, studentCount);
  const roomId = await createRoom(institutionId, { capacity: 10 });
  return { examId, roomId };
}

describe("examSeating.generate (X06-T5)", () => {
  it("exam_controller generates a plan with seatCount; a second call regenerates to version 2", async () => {
    const inst = await createTestInstitution("seating-action-happy");
    try {
      const { examId, roomId } = await setupFixture(inst.institutionId);

      const first = await callAs(inst, "exam_controller", generateSeatingPlan, {
        examId,
        slotStart: FUTURE_SLOT,
        rooms: [{ roomId }],
      });
      expect(first).toMatchObject({ ok: true, data: { versionNo: 1, seatCount: 3 } });

      const second = await callAs(inst, "exam_controller", generateSeatingPlan, {
        examId,
        slotStart: FUTURE_SLOT,
        rooms: [{ roomId }],
      });
      expect(second).toMatchObject({ ok: true, data: { versionNo: 2, seatCount: 3 } });
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("forbidden with MODULE_DISABLED_MESSAGE when exam_seating is stored off, and no plan row is written", async () => {
    const inst = await createTestInstitution("seating-action-module-off");
    try {
      const { examId, roomId } = await setupFixture(inst.institutionId);
      await sql`
        update public.institutions
        set settings = jsonb_set(settings, '{modules,exam_seating}', 'false'::jsonb)
        where id = ${inst.institutionId}
      `;

      const result = await callAs(inst, "exam_controller", generateSeatingPlan, {
        examId,
        slotStart: FUTURE_SLOT,
        rooms: [{ roomId }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE } });

      const [{ count }] = await sql`select count(*)::int from public.exam_seating_plans where exam_id = ${examId}`;
      expect(count).toBe(0);
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("admin lacks exam.manage and is forbidden", async () => {
    const inst = await createTestInstitution("seating-action-admin-forbidden");
    try {
      const { examId, roomId } = await setupFixture(inst.institutionId);

      const result = await callAs(inst, "admin", generateSeatingPlan, {
        examId,
        slotStart: FUTURE_SLOT,
        rooms: [{ roomId }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("too few seats for the student count maps to conflict", async () => {
    const inst = await createTestInstitution("seating-action-conflict");
    try {
      const { examId } = await setupFixture(inst.institutionId, 3);
      const smallRoom = await createRoom(inst.institutionId, { capacity: 2 });

      const result = await callAs(inst, "exam_controller", generateSeatingPlan, {
        examId,
        slotStart: FUTURE_SLOT,
        rooms: [{ roomId: smallRoom }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "conflict" } });
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });

  it("a slot that has already started maps to invalid_state", async () => {
    const inst = await createTestInstitution("seating-action-started");
    try {
      const { examId, roomId } = await setupFixture(inst.institutionId);

      const result = await callAs(inst, "exam_controller", generateSeatingPlan, {
        examId,
        slotStart: PAST_SLOT,
        rooms: [{ roomId }],
      });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });
});
