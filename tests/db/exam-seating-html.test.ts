// X06-T8 — examSeating.chartHtml / .admitCardsHtml, exercised as the
// registered defineQuery actions (callAs), same fixture shape as
// tests/db/exam-seating-queries.test.ts. Fixtures seat students via the
// real `generate_seating_plan` RPC (T3).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { examSeatingAdmitCardsHtmlQuery, examSeatingChartHtmlQuery } from "@/modules/exam-seating/query-defs";
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

const FUTURE_SLOT_1 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const FUTURE_SLOT_2 = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2014-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function createRoom(
  institutionId: string,
  overrides: Partial<{ name: string; capacity: number }> = {},
): Promise<string> {
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

/** Same as T2/T3/T6's cleanup: the "one current row" invariant is a plain partial unique index, not a deferrable trigger. */
async function cleanupSeatingFixture(institutionId: string): Promise<void> {
  await sql`delete from public.exam_seats where institution_id = ${institutionId}`;
  await sql`delete from public.exam_seating_plans where institution_id = ${institutionId} and superseded_by is not null`;
  await sql`delete from public.exam_seating_plans where institution_id = ${institutionId}`;
}

describe("examSeating.chartHtml / .admitCardsHtml (X06-T8)", () => {
  it("chartHtml contains every room name and a seated student's name; admitCardsHtml: one card per active student, papers in time order, planned seat vs 'To be announced'", async () => {
    const inst = await createTestInstitution("seating-html");
    try {
      const yearId = await createAcademicYear(inst.institutionId);
      const termId = await createTerm(inst.institutionId, yearId);
      const subject1 = await createSubject(inst.institutionId, { name: "Science" });
      const subject2 = await createSubject(inst.institutionId, { name: "Mathematics" });
      const grade = await createGrade(inst.institutionId, { code: "VI", sortKey: 6 });
      const section = await createClassSection(inst.institutionId, grade, yearId, { name: "A" });
      const examId = await createExam(inst.institutionId, termId);
      await insertExamPaper(inst.institutionId, examId, section, subject1, FUTURE_SLOT_1);
      await insertExamPaper(inst.institutionId, examId, section, subject2, FUTURE_SLOT_2);

      const student1 = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
      const student2 = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
      await createEnrolment(inst.institutionId, student1, section, yearId, { rollNo: 1 });
      await createEnrolment(inst.institutionId, student2, section, yearId, { rollNo: 2 });

      const room1 = await createRoom(inst.institutionId, { name: "Hall A", capacity: 2 });

      // Only the first slot gets seated — the second stays "To be announced".
      const gen = await inst.clientAs("exam_controller").rpc("generate_seating_plan", {
        p_institution_id: inst.institutionId,
        p_exam_id: examId,
        p_slot_start: FUTURE_SLOT_1,
        p_rooms: [{ room_id: room1 }],
      });
      expect(gen.error).toBeNull();

      // --- chartHtml ---
      const chart = await callAs(inst, "exam_controller", examSeatingChartHtmlQuery, { planId: gen.data.id });
      expect(chart.ok).toBe(true);
      if (!chart.ok) throw new Error("unreachable");
      expect(chart.data).not.toBeNull();
      const chartHtml = (chart.data as { html: string }).html;
      expect(chartHtml).toContain("Hall A");
      const [seated] = await sql`select first_name from public.students where id = ${student1}`;
      expect(chartHtml).toContain(seated.first_name as string);

      // --- admitCardsHtml for the section ---
      const cards = await callAs(inst, "exam_controller", examSeatingAdmitCardsHtmlQuery, {
        examId,
        classSectionId: section,
      });
      expect(cards.ok).toBe(true);
      if (!cards.ok) throw new Error("unreachable");
      expect(cards.data).not.toBeNull();
      const cardsHtml = (cards.data as { html: string }).html;
      // One card (<section class="page">) per active student.
      expect(cardsHtml.match(/<section class="page">/g)).toHaveLength(2);
      // Planned slot shows the room; unplanned slot shows "To be announced".
      expect(cardsHtml).toContain("Hall A, Seat");
      expect(cardsHtml).toContain("To be announced");
      // Papers in time order: the planned slot's row precedes the unplanned one for each card.
      const firstCardEnd = cardsHtml.indexOf("To be announced");
      const firstCardSeat = cardsHtml.indexOf("Hall A, Seat");
      expect(firstCardSeat).toBeGreaterThanOrEqual(0);
      expect(firstCardSeat).toBeLessThan(firstCardEnd);

      // --- admitCardsHtml with studentId -> one card ---
      const oneCard = await callAs(inst, "exam_controller", examSeatingAdmitCardsHtmlQuery, {
        examId,
        classSectionId: section,
        studentId: student1,
      });
      expect(oneCard.ok).toBe(true);
      if (!oneCard.ok) throw new Error("unreachable");
      expect(oneCard.data).not.toBeNull();
      const oneCardHtml = (oneCard.data as { html: string }).html;
      expect(oneCardHtml.match(/<section class="page">/g)).toHaveLength(1);

      // --- guardian: exam_papers is staff-only (RLS) -> no paper visible -> null ---
      const guardianCards = await callAs(inst, "guardian", examSeatingAdmitCardsHtmlQuery, {
        examId,
        classSectionId: section,
      });
      expect(guardianCards.ok).toBe(true);
      if (!guardianCards.ok) throw new Error("unreachable");
      expect(guardianCards.data).toBeNull();

      // --- another institution's exam -> null for both html queries ---
      const other = await createTestInstitution("seating-html-other");
      try {
        const otherChart = await callAs(other, "exam_controller", examSeatingChartHtmlQuery, { planId: gen.data.id });
        expect(otherChart.ok).toBe(true);
        if (!otherChart.ok) throw new Error("unreachable");
        expect(otherChart.data).toBeNull();

        const otherCards = await callAs(other, "exam_controller", examSeatingAdmitCardsHtmlQuery, {
          examId,
          classSectionId: section,
        });
        expect(otherCards.ok).toBe(true);
        if (!otherCards.ok) throw new Error("unreachable");
        expect(otherCards.data).toBeNull();
      } finally {
        await other.cleanup();
      }
    } finally {
      await cleanupSeatingFixture(inst.institutionId);
      await inst.cleanup();
    }
  });
});
