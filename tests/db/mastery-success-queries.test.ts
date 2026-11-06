// M20-T9 — mastery.studentSuccessRows / mastery.interventions, exercised as
// the registered defineQuery actions (callAs), same shape as
// tests/db/mastery-queries.test.ts (T8).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { masteryInterventionsQuery, masteryStudentSuccessRowsQuery } from "@/modules/mastery/query-defs";
import { createAttendanceRecord, createAttendanceSession, closeFactoriesHelper } from "../helpers/factories";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { buildMasteryFixture, closeMasteryFixtureHelper, insertGapPlan, insertSnapshots } from "../helpers/mastery-fixture";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeMasteryFixtureHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// Mirrors DEFAULT_INSTITUTION_SETTINGS (tests/db/attendance-daily-counts.test.ts's ATTENDANCE_STATUSES).
const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true },
];

async function setAttendanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'attendance', jsonb_build_object(
        'mode', 'daily',
        'correction_window_days', 0,
        'statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb,
        'alert_thresholds', jsonb_build_object('warn', 80, 'critical', 75)
      )
    )
    where id = ${institutionId}
  `;
}

function shiftFromToday(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A direct `results` row (service role) — isolates the trend math from compute_mastery/exam publishing. */
async function insertResult(institutionId: string, examId: string, studentId: string, percentage: number): Promise<void> {
  await sql`
    insert into public.results (institution_id, exam_id, student_id, snapshot, total, max_total, percentage, grade)
    values (${institutionId}, ${examId}, ${studentId}, ${sql.json({})}, ${percentage}, 100, ${percentage}, 'B')
  `;
}

async function insertPublishedExam(institutionId: string, academicYearId: string, termId: string, publishedAt: string): Promise<string> {
  const [row] = await sql`
    insert into public.exams (institution_id, academic_year_id, term_id, name, type, status, published_at)
    values (${institutionId}, ${academicYearId}, ${termId}, ${`Exam-${crypto.randomUUID().slice(0, 8)}`}, 'unit_test', 'published', ${publishedAt})
    returning id
  `;
  return row.id as string;
}

describe("mastery.studentSuccessRows / mastery.interventions (M20-T9)", () => {
  it("section A: 3-gap student is support with a declining trend; A2 at 70% attendance is watch", async () => {
    const inst = await createTestInstitution("mastery-success-rows");
    try {
      await setAttendanceSettings(inst.institutionId);
      const fx = await buildMasteryFixture(inst);
      // RLS needs staff.user_id to let the teacher read their own staff row's
      // full_name via embed (tests/db/hr-queries.test.ts's own pattern — the
      // generic roles.ts fixture leaves staff.user_id unset).
      await sql`update public.staff set user_id = ${inst.users.teacher.id} where id = ${fx.teacherStaffId}`;

      // Fixture student: 3 gap units (score < 0.6, confidence >= 0.5) + 1 confident non-gap.
      await insertSnapshots(inst, fx, [
        { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[0], score: 0.5, confidence: 0.6 },
        { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[1], score: 0.5, confidence: 0.6 },
        { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.science.id, curriculumUnitId: fx.subjects.science.units[0], score: 0.5, confidence: 0.6 },
        { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.science.id, curriculumUnitId: fx.subjects.science.units[1], score: 0.9, confidence: 0.8 },
      ]);
      // Two published exams, 72 -> 60 (declining).
      const exam1 = await insertPublishedExam(inst.institutionId, fx.academicYearId, fx.termId, shiftFromToday(-10) + "T00:00:00Z");
      const exam2 = await insertPublishedExam(inst.institutionId, fx.academicYearId, fx.termId, shiftFromToday(-5) + "T00:00:00Z");
      await insertResult(inst.institutionId, exam1, fx.students.fixture, 72);
      await insertResult(inst.institutionId, exam2, fx.students.fixture, 60);

      // A2: one confident non-gap snapshot (avoids "Low evidence") + 70% attendance.
      await insertSnapshots(inst, fx, [
        { studentId: fx.students.a2, classSectionId: fx.sections.a, subjectId: fx.subjects.science.id, curriculumUnitId: fx.subjects.science.units[1], score: 0.8, confidence: 0.7 },
      ]);
      const codes = ["P", "P", "P", "P", "P", "P", "P", "A", "A", "A"];
      for (let i = 0; i < codes.length; i++) {
        const sessionId = await createAttendanceSession(inst.institutionId, fx.sections.a, { date: shiftFromToday(-(i + 1)) });
        await createAttendanceRecord(inst.institutionId, sessionId, fx.students.a2, { status: codes[i] });
      }

      const result = await callAs(inst, "teacher", masteryStudentSuccessRowsQuery, { classSectionId: fx.sections.a });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");

      const fixtureRow = result.data.find((r) => r.student_id === fx.students.fixture);
      expect(fixtureRow).toMatchObject({ risk: "support", trend: "down", section_label: expect.stringContaining("-A") });
      expect(fixtureRow?.flags).toEqual(["3 unit gaps", "Declining results"]);

      const a2Row = result.data.find((r) => r.student_id === fx.students.a2);
      expect(a2Row).toMatchObject({ risk: "watch", attendance_pct: 70 });
      expect(a2Row?.flags).toEqual(["Attendance below 75%"]);
    } finally {
      await inst.cleanup();
    }
  });

  it("an active plan sets support_owner, last_contact and the Intervention active flag", async () => {
    const inst = await createTestInstitution("mastery-success-plan");
    try {
      const fx = await buildMasteryFixture(inst);
      await sql`update public.staff set user_id = ${inst.users.teacher.id} where id = ${fx.teacherStaffId}`;
      // One confident non-gap snapshot so "Low evidence" doesn't fire.
      await insertSnapshots(inst, fx, [
        { studentId: fx.students.fixture, classSectionId: fx.sections.a, subjectId: fx.subjects.maths.id, curriculumUnitId: fx.subjects.maths.units[0], score: 0.8, confidence: 0.7 },
      ]);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture, "active");
      const [planRow] = await sql`select updated_at from public.insight_actions where id = ${plan.actionId}`;
      const expectedDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(
        new Date(planRow.updated_at as string),
      );

      const result = await callAs(inst, "teacher", masteryStudentSuccessRowsQuery, { classSectionId: fx.sections.a });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");

      const row = result.data.find((r) => r.student_id === fx.students.fixture);
      expect(row).toMatchObject({ support_owner: "Test teacher", last_contact: expectedDate });
      expect(row?.flags).toContain("Intervention active");
    } finally {
      await inst.cleanup();
    }
  });

  it("class teacher's interventions returns the exact fixture InterventionPlan", async () => {
    const inst = await createTestInstitution("mastery-interventions-teacher");
    try {
      const fx = await buildMasteryFixture(inst);
      await sql`update public.staff set user_id = ${inst.users.teacher.id} where id = ${fx.teacherStaffId}`;
      const plan = await insertGapPlan(inst, fx, fx.students.fixture);

      const result = await callAs(inst, "teacher", masteryInterventionsQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data).toEqual([
        {
          id: plan.actionId,
          student_id: fx.students.fixture,
          owner: "Test teacher",
          goal: "Raise 2 gap units to 60% mastery",
          steps: [{ title: "Re-teach: Algebra basics (Maths)", due: shiftFromToday(7), done: false }],
          status: "proposed",
          review_date: shiftFromToday(14),
          restricted: true,
        },
      ]);
    } finally {
      await inst.cleanup();
    }
  });

  it("admin sees no plans (RLS: not owner/principal, not the class teacher)", async () => {
    const inst = await createTestInstitution("mastery-interventions-admin");
    try {
      const fx = await buildMasteryFixture(inst);
      await insertGapPlan(inst, fx, fx.students.fixture);

      const result = await callAs(inst, "admin", masteryInterventionsQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian is forbidden (no mastery.review)", async () => {
    const inst = await createTestInstitution("mastery-success-forbidden-guardian");
    try {
      const fx = await buildMasteryFixture(inst);

      const result = await callAs(inst, "guardian", masteryStudentSuccessRowsQuery, { classSectionId: fx.sections.a });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
