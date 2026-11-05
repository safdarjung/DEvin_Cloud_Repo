// M19-T4 — migration 0092 part 3: insight_src_attendance, insight_src_marks,
// insight_src_submissions. Real signed-in clients + real RLS/grants, same
// pattern as insights-rls.test.ts.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  plantAcademicSetup,
  plantAttendance,
  plantMarks,
  plantStudent,
  plantSubmissions,
} from "../helpers/insight-fixtures";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

// 05 §4.1 default statuses, mirrors attendance-actions.test.ts.
const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true },
];

async function setAttendanceStatuses(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('attendance', jsonb_build_object('statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb))
    where id = ${institutionId}
  `;
}

interface AttendanceSourceRow {
  level: string;
  class_section_id: string;
  section_label: string;
  student_id: string | null;
  recent_days: number;
  base_days: number;
  recent_present: string;
  recent_denominator: string;
  base_present: string;
  base_denominator: string;
}

describe("0092 part 3: insight_src_attendance", () => {
  it("exact weighted P/A sums in R and B; >75% student excluded; period sessions and institution B ignored", async () => {
    const inst = await createTestInstitution("insight-src-attendance");
    const admin = adminClient();
    try {
      await setAttendanceStatuses(inst.institutionId);
      const setup = await plantAcademicSetup(sql, inst.institutionId);
      const sLow = await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
      const sHigh = await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
      const asOf = "2026-11-20";

      // R = asOf-6..asOf (7 days): sLow 3P/4A, sHigh 7P.
      const recentSessions = Array.from({ length: 7 }, (_, i) => ({
        daysAgo: i,
        records: { [sLow]: i < 3 ? "P" : "A", [sHigh]: "P" },
      }));
      // B = asOf-34..asOf-7 (use 10 of the 28 days): both students all P.
      const baseSessions = Array.from({ length: 10 }, (_, i) => ({
        daysAgo: 7 + i,
        records: { [sLow]: "P", [sHigh]: "P" },
      }));
      await plantAttendance(sql, inst.institutionId, setup.classSectionId, asOf, [...recentSessions, ...baseSessions]);

      // A period session inside the B window, on a date no daily session
      // used — if the source's period_id-is-null filter were missing, this
      // extra P would inflate base_days/base_present/base_denominator above.
      const [period] = await sql`
        insert into public.periods (institution_id, seq, name, starts_at, ends_at)
        values (${inst.institutionId}, 1, 'P1', '08:00', '08:40')
        returning id
      `;
      await plantAttendance(sql, inst.institutionId, setup.classSectionId, asOf, [
        { daysAgo: 25, periodId: period.id as string, records: { [sLow]: "P" } },
      ]);

      // Institution B — its own section, its own low-attendance student;
      // must never surface when queried under institution A.
      const instB = await createTestInstitution("insight-src-attendance-b");
      await setAttendanceStatuses(instB.institutionId);
      const setupB = await plantAcademicSetup(sql, instB.institutionId);
      const studentB = await plantStudent(sql, instB.institutionId, setupB.classSectionId, setupB.academicYearId);
      await plantAttendance(sql, instB.institutionId, setupB.classSectionId, asOf, [
        { daysAgo: 0, records: { [studentB]: "A" } },
      ]);

      try {
        const { data, error } = await admin.rpc("insight_src_attendance", {
          p_institution_id: inst.institutionId,
          p_as_of: asOf,
          p_student_max_recent_pct: 75,
        });
        expect(error).toBeNull();
        const rows = data as AttendanceSourceRow[];

        const sectionRow = rows.find((r) => r.level === "section");
        expect(sectionRow).toMatchObject({
          class_section_id: setup.classSectionId,
          section_label: setup.sectionLabel,
          student_id: null,
          recent_days: 7,
          base_days: 10,
        });
        expect(Number(sectionRow!.recent_present)).toBe(10); // sLow 3 + sHigh 7
        expect(Number(sectionRow!.recent_denominator)).toBe(14); // 7 records x 2 students
        expect(Number(sectionRow!.base_present)).toBe(20); // 10 days x 2 students, all P
        expect(Number(sectionRow!.base_denominator)).toBe(20);

        const lowRow = rows.find((r) => r.level === "student" && r.student_id === sLow);
        expect(lowRow).toMatchObject({ class_section_id: setup.classSectionId, recent_days: 7, base_days: 10 });
        expect(Number(lowRow!.recent_present)).toBe(3);
        expect(Number(lowRow!.recent_denominator)).toBe(7);
        expect(Number(lowRow!.base_present)).toBe(10);
        expect(Number(lowRow!.base_denominator)).toBe(10);

        // sHigh is at 100% recent attendance: above the 75% cutoff, excluded.
        expect(rows.find((r) => r.level === "student" && r.student_id === sHigh)).toBeUndefined();

        // Institution B never appears.
        expect(rows.some((r) => r.class_section_id === setupB.classSectionId)).toBe(false);
        expect(rows.some((r) => r.student_id === studentB)).toBe(false);
      } finally {
        await instB.cleanup();
      }
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("is denied for an authenticated caller", async () => {
    const inst = await createTestInstitution("insight-src-attendance-denied");
    try {
      const { data, error } = await inst
        .clientAs("principal")
        .rpc("insight_src_attendance", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20", p_student_max_recent_pct: 75 });
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});

interface MarksSourceRow {
  student_id: string;
  class_section_id: string;
  section_label: string;
  subject_id: string;
  subject_name: string;
  prev_exam_id: string;
  prev_pct: string;
  last_exam_id: string;
  last_pct: string;
  last_published_on: string;
}

describe("0092 part 3: insight_src_marks", () => {
  it("drop between the last two published exams; absent/superseded/draft ignored; stale last exam excluded", async () => {
    const inst = await createTestInstitution("insight-src-marks");
    const admin = adminClient();
    try {
      const realSetup = await plantAcademicSetup(sql, inst.institutionId);
      const asOf = "2026-11-20";

      // Student C: two published exams, clean drop.
      const studentC = await plantStudent(sql, inst.institutionId, realSetup.classSectionId, realSetup.academicYearId);
      const { examIds: examsC } = await plantMarks(sql, inst.institutionId, realSetup, asOf, [
        { daysAgo: 100, marks: [{ studentId: studentC, marksObtained: 80 }] },
        { daysAgo: 10, marks: [{ studentId: studentC, marksObtained: 60 }] },
      ]);

      // Student D: the "last" exam's mark is superseded — the superseded
      // 99% must be ignored in favour of the current 55%.
      const studentD = await plantStudent(sql, inst.institutionId, realSetup.classSectionId, realSetup.academicYearId);
      const { examIds: examsD, paperIds: papersD } = await plantMarks(sql, inst.institutionId, realSetup, asOf, [
        { daysAgo: 100, marks: [{ studentId: studentD, marksObtained: 80 }] },
        { daysAgo: 10, marks: [] }, // paper only — both mark versions inserted together below
      ]);
      // Both versions in one statement/transaction, old already pointing at
      // new, so the "one current row" deferred constraint never sees two.
      await sql`
        with new_mark as (
          insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, version_no)
          values (${inst.institutionId}, ${papersD[1]}, ${studentD}, 55, 2)
          returning id
        )
        insert into public.marks (institution_id, exam_paper_id, student_id, marks_obtained, version_no, superseded_by)
        select ${inst.institutionId}, ${papersD[1]}, ${studentD}, 99, 1, new_mark.id from new_mark
      `;

      // Student E: absent on the "last" exam — that exam must drop out
      // entirely, leaving E with a single base row (no pair, no insight row).
      const studentE = await plantStudent(sql, inst.institutionId, realSetup.classSectionId, realSetup.academicYearId);
      await plantMarks(sql, inst.institutionId, realSetup, asOf, [
        { daysAgo: 100, marks: [{ studentId: studentE, marksObtained: 80 }] },
        { daysAgo: 10, marks: [{ studentId: studentE, marksObtained: null, isAbsent: true }] },
      ]);

      // Student F: a draft exam more recent than the real "last" must be
      // ignored — the real last published exam (40 days back) is too stale.
      const studentF = await plantStudent(sql, inst.institutionId, realSetup.classSectionId, realSetup.academicYearId);
      await plantMarks(sql, inst.institutionId, realSetup, asOf, [
        { daysAgo: 100, marks: [{ studentId: studentF, marksObtained: 90 }] },
        { daysAgo: 40, marks: [{ studentId: studentF, marksObtained: 60 }] },
        { daysAgo: 2, status: "draft", marks: [{ studentId: studentF, marksObtained: 10 }] },
      ]);

      const { data, error } = await admin.rpc("insight_src_marks", {
        p_institution_id: inst.institutionId,
        p_as_of: asOf,
        p_min_drop_pts: 15,
      });
      expect(error).toBeNull();
      const rows = data as MarksSourceRow[];

      const rowC = rows.find((r) => r.student_id === studentC);
      expect(rowC).toMatchObject({
        class_section_id: realSetup.classSectionId,
        section_label: realSetup.sectionLabel,
      });
      expect(rowC!.prev_exam_id).toBe(examsC[0]);
      expect(Number(rowC!.prev_pct)).toBe(80);
      expect(rowC!.last_exam_id).toBe(examsC[1]);
      expect(Number(rowC!.last_pct)).toBe(60);

      const rowD = rows.find((r) => r.student_id === studentD);
      expect(rowD).toBeDefined();
      expect(rowD!.last_exam_id).toBe(examsD[1]);
      expect(Number(rowD!.last_pct)).toBe(55); // current version, not the superseded 99

      expect(rows.find((r) => r.student_id === studentE)).toBeUndefined();
      expect(rows.find((r) => r.student_id === studentF)).toBeUndefined();
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("is denied for an authenticated caller", async () => {
    const inst = await createTestInstitution("insight-src-marks-denied");
    try {
      const { data, error } = await inst
        .clientAs("principal")
        .rpc("insight_src_marks", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20", p_min_drop_pts: 15 });
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});

interface SubmissionsSourceRow {
  level: string;
  class_section_id: string;
  section_label: string;
  student_id: string | null;
  due_count: number | null;
  missing_count: number | null;
  awaiting_count: number | null;
  oldest_awaiting_days: number | null;
}

describe("0092 part 3: insight_src_submissions", () => {
  it("student-level missing work (closed counted, draft not); section-level stale submitted (graded excluded)", async () => {
    const inst = await createTestInstitution("insight-src-submissions");
    const admin = adminClient();
    try {
      const setup = await plantAcademicSetup(sql, inst.institutionId);
      const [{ staff_id: teacherStaffId }] = (await sql`
        select staff_id from public.memberships
        where institution_id = ${inst.institutionId} and user_id = ${inst.users.teacher.id} and role = 'teacher'
      `) as unknown as [{ staff_id: string }];
      const teacherUserId = inst.users.teacher.id;
      const asOf = "2026-11-20";

      const s1 = await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
      const s2 = await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);
      const s3 = await plantStudent(sql, inst.institutionId, setup.classSectionId, setup.academicYearId);

      // Missing-work window (due asOf-10, inside [asOf-27, asOf]): 2
      // published + 1 closed with no submissions (due_count/missing_count
      // should be 3, not 4 — the draft below must not count).
      await plantSubmissions(sql, inst.institutionId, setup, teacherStaffId, teacherUserId, asOf, [
        { daysAgo: 10, status: "published" },
        { daysAgo: 10, status: "published" },
        { daysAgo: 10, status: "closed" },
        { daysAgo: 10, status: "draft" },
      ]);

      // Section-staleness assignments: due far outside the missing-work
      // window (daysAgo 40) so they never enter due_count/missing_count;
      // 5 stale 'submitted' rows + 2 'graded' rows 8 days old.
      const staleSubmitted = Array.from({ length: 5 }, () => ({
        daysAgo: 40,
        submissions: [{ studentId: s1, submittedDaysAgo: 8, status: "submitted" as const }],
      }));
      const staleGraded = Array.from({ length: 2 }, () => ({
        daysAgo: 40,
        submissions: [{ studentId: s1, submittedDaysAgo: 8, status: "graded" as const }],
      }));
      await plantSubmissions(sql, inst.institutionId, setup, teacherStaffId, teacherUserId, asOf, [
        ...staleSubmitted,
        ...staleGraded,
      ]);

      const { data, error } = await admin.rpc("insight_src_submissions", {
        p_institution_id: inst.institutionId,
        p_as_of: asOf,
      });
      expect(error).toBeNull();
      const rows = data as SubmissionsSourceRow[];

      for (const studentId of [s1, s2, s3]) {
        const row = rows.find((r) => r.level === "student" && r.student_id === studentId);
        expect(row).toMatchObject({ class_section_id: setup.classSectionId, due_count: 3, missing_count: 3 });
      }

      const sectionRow = rows.find((r) => r.level === "section");
      expect(sectionRow).toMatchObject({
        class_section_id: setup.classSectionId,
        section_label: setup.sectionLabel,
        awaiting_count: 5,
        oldest_awaiting_days: 8,
      });
    } finally {
      await inst.cleanup();
    }
  }, 30_000);

  it("is denied for an authenticated caller", async () => {
    const inst = await createTestInstitution("insight-src-submissions-denied");
    try {
      const { data, error } = await inst
        .clientAs("principal")
        .rpc("insight_src_submissions", { p_institution_id: inst.institutionId, p_as_of: "2026-11-20" });
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});
