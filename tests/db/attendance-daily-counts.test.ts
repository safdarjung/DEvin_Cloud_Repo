import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceRecord,
  createAttendanceSession,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

// M16-T3 — public.attendance_daily_counts (06 M16 rulings, "0078").

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

// Mirrors DEFAULT_INSTITUTION_SETTINGS so app.validate_attendance_status accepts 'P'/'A'.
const ATTENDANCE_STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true },
];

async function setAttendanceSettings(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('attendance', jsonb_build_object('statuses', ${sql.json(ATTENDANCE_STATUSES)}::jsonb))
    where id = ${institutionId}
  `;
}

async function insertStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function createPeriod(institutionId: string, seq = 9): Promise<string> {
  const [row] = await sql`
    insert into public.periods (institution_id, seq, name, starts_at, ends_at)
    values (${institutionId}, ${seq}, ${`Period ${seq}`}, '08:00', '08:40')
    returning id
  `;
  return row.id as string;
}

async function linkGuardianToStudent(institutionId: string, guardianUserId: string, studentId: string): Promise<void> {
  const [membership] = await sql`
    select guardian_id from public.memberships where institution_id = ${institutionId} and user_id = ${guardianUserId}
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary)
    values (${institutionId}, ${membership.guardian_id}, ${studentId}, 'father', true)
  `;
}

const DATES = ["2026-08-01", "2026-08-02", "2026-08-03"];

interface Fixture {
  sectionA: string;
  sectionB: string;
  studentA1: string;
  studentA2: string;
  studentB1: string;
  periodSessionId: string;
}

async function buildFixture(inst: TestInstitution): Promise<Fixture> {
  await setAttendanceSettings(inst.institutionId);
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);

  const [teacherStaff] = await sql`
    select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
  `;
  const sectionA = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A", classTeacherId: teacherStaff.staff_id });
  const sectionB = await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" });

  const studentA1 = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
  const studentA2 = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
  const studentB1 = await insertStudent(inst.institutionId, `ADM-${crypto.randomUUID().slice(0, 8)}`);
  await createEnrolment(inst.institutionId, studentA1, sectionA, yearId);
  await createEnrolment(inst.institutionId, studentA2, sectionA, yearId);
  await createEnrolment(inst.institutionId, studentB1, sectionB, yearId);

  await linkGuardianToStudent(inst.institutionId, inst.users.guardian.id, studentA1);

  for (const date of DATES) {
    const sessionA = await createAttendanceSession(inst.institutionId, sectionA, { date });
    await createAttendanceRecord(inst.institutionId, sessionA, studentA1, { status: "P" });
    await createAttendanceRecord(inst.institutionId, sessionA, studentA2, { status: "A" });

    const sessionB = await createAttendanceSession(inst.institutionId, sectionB, { date });
    await createAttendanceRecord(inst.institutionId, sessionB, studentB1, { status: "P" });
  }

  // A period session on the first date, same section+day as the daily one —
  // must be excluded from the aggregate (s.period_id is null).
  const periodId = await createPeriod(inst.institutionId);
  const [periodSession] = await sql`
    insert into public.attendance_sessions (institution_id, class_section_id, date, status, period_id)
    values (${inst.institutionId}, ${sectionA}, ${DATES[0]}, 'submitted', ${periodId})
    returning id
  `;
  await createAttendanceRecord(inst.institutionId, periodSession.id as string, studentA1, { status: "P" });

  return { sectionA, sectionB, studentA1, studentA2, studentB1, periodSessionId: periodSession.id as string };
}

function sumN(rows: { n: number | string }[]): number {
  return rows.reduce((total, r) => total + Number(r.n), 0);
}

describe("public.attendance_daily_counts (0078)", () => {
  it("the principal gets counts for both sections over 3 dates, excluding a period session", async () => {
    const inst = await createTestInstitution("daily-counts-principal");
    try {
      const fixture = await buildFixture(inst);
      const { data, error } = await inst.clientAs("principal").rpc("attendance_daily_counts", {
        p_institution_id: inst.institutionId,
        p_from: DATES[0],
        p_to: DATES[2],
      });
      expect(error).toBeNull();
      const rows = data as { date: string; class_section_id: string | null; status: string; n: number }[];

      // class_section_id is null unless p_by_section.
      expect(rows.every((r) => r.class_section_id === null)).toBe(true);

      const dates = new Set(rows.map((r) => r.date.slice(0, 10)));
      expect(dates).toEqual(new Set(DATES));

      // Per date: P = studentA1 + studentB1 = 2 (the period-session P record for
      // studentA1 is excluded); A = studentA2 = 1.
      for (const date of DATES) {
        const dayRows = rows.filter((r) => r.date.slice(0, 10) === date);
        const p = dayRows.find((r) => r.status === "P");
        const a = dayRows.find((r) => r.status === "A");
        expect(Number(p?.n)).toBe(2);
        expect(Number(a?.n)).toBe(1);
      }
      void fixture;
    } finally {
      await inst.cleanup();
    }
  });

  it("p_by_section groups rows per section; class_section_id matches the section", async () => {
    const inst = await createTestInstitution("daily-counts-by-section");
    try {
      const fixture = await buildFixture(inst);
      const { data, error } = await inst.clientAs("principal").rpc("attendance_daily_counts", {
        p_institution_id: inst.institutionId,
        p_from: DATES[0],
        p_to: DATES[0],
        p_by_section: true,
      });
      expect(error).toBeNull();
      const rows = data as { date: string; class_section_id: string; status: string; n: number }[];

      const aRows = rows.filter((r) => r.class_section_id === fixture.sectionA);
      const bRows = rows.filter((r) => r.class_section_id === fixture.sectionB);
      expect(Number(aRows.find((r) => r.status === "P")?.n)).toBe(1);
      expect(Number(aRows.find((r) => r.status === "A")?.n)).toBe(1);
      expect(Number(bRows.find((r) => r.status === "P")?.n)).toBe(1);
      expect(rows.every((r) => r.class_section_id !== null)).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("the class teacher of section A sees only A's counts", async () => {
    const inst = await createTestInstitution("daily-counts-teacher");
    try {
      const fixture = await buildFixture(inst);
      const { data, error } = await inst.clientAs("teacher").rpc("attendance_daily_counts", {
        p_institution_id: inst.institutionId,
        p_from: DATES[0],
        p_to: DATES[2],
        p_by_section: true,
      });
      expect(error).toBeNull();
      const rows = data as { class_section_id: string; status: string; n: number }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.class_section_id === fixture.sectionA)).toBe(true);
      expect(sumN(rows.filter((r) => r.status === "P"))).toBe(DATES.length); // studentA1 only, period record excluded
    } finally {
      await inst.cleanup();
    }
  });

  it("a guardian sees only their own child's counts, with no section/student filter passed", async () => {
    const inst = await createTestInstitution("daily-counts-guardian");
    try {
      await buildFixture(inst);
      const { data, error } = await inst.clientAs("guardian").rpc("attendance_daily_counts", {
        p_institution_id: inst.institutionId,
        p_from: DATES[0],
        p_to: DATES[2],
      });
      expect(error).toBeNull();
      const rows = data as { status: string; n: number }[];
      // Only studentA1 (the guardian's linked child) is visible: P = 1/day, no A.
      expect(sumN(rows.filter((r) => r.status === "P"))).toBe(DATES.length);
      expect(rows.some((r) => r.status === "A")).toBe(false);
    } finally {
      await inst.cleanup();
    }
  });

  it("p_student_id of another family's child returns 0 rows", async () => {
    const inst = await createTestInstitution("daily-counts-other-child");
    try {
      const fixture = await buildFixture(inst);
      const { data, error } = await inst.clientAs("guardian").rpc("attendance_daily_counts", {
        p_institution_id: inst.institutionId,
        p_from: DATES[0],
        p_to: DATES[2],
        p_student_id: fixture.studentB1,
      });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("another institution's id returns 0 rows (cross-tenant isolation)", { timeout: 30000 }, async () => {
    await withTwoInstitutions(async (a, b) => {
      await buildFixture(a);
      const own = await a.clientAs("principal").rpc("attendance_daily_counts", {
        p_institution_id: a.institutionId,
        p_from: DATES[0],
        p_to: DATES[0],
      });
      expect(own.data.length).toBeGreaterThan(0);

      const cross = await b.clientAs("principal").rpc("attendance_daily_counts", {
        p_institution_id: a.institutionId,
        p_from: DATES[0],
        p_to: DATES[0],
      });
      expect(cross.error).toBeNull();
      expect(cross.data).toEqual([]);
    });
  });

  it("rejects a range over 91 days and accepts exactly 91", async () => {
    const inst = await createTestInstitution("daily-counts-range");
    try {
      const over = await inst.clientAs("principal").rpc("attendance_daily_counts", {
        p_institution_id: inst.institutionId,
        p_from: "2026-01-01",
        p_to: "2026-04-03", // 92 days
      });
      expect(over.error?.message).toContain("code:validation_failed");

      const atLimit = await inst.clientAs("principal").rpc("attendance_daily_counts", {
        p_institution_id: inst.institutionId,
        p_from: "2026-01-01",
        p_to: "2026-04-02", // 91 days
      });
      expect(atLimit.error).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("anon cannot execute the function", async () => {
    const inst = await createTestInstitution("daily-counts-anon");
    try {
      const { error } = await inst.clientAsAnon().rpc("attendance_daily_counts", {
        p_institution_id: inst.institutionId,
        p_from: DATES[0],
        p_to: DATES[0],
      });
      expect(error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });
});
