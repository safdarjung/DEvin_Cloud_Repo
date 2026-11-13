import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolSet } from "ai";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Curveball suite for the App Orb's server-side AI tools: every tool's
// execute() is called directly (no model) as a real signed-in role, with
// awkward inputs, and the answer is checked against what the fixture put in
// the database. Tests named "BUG: ..." fail because the code is wrong; they
// stay as the record of the defect.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import type { Database } from "@/lib/db/types";
import type { FixtureRole, TestInstitution } from "../helpers/roles";
import type { TenantContext } from "@/lib/auth/types";
import { hasPermission } from "@/lib/auth/require";
import { getActionMeta } from "@/lib/actions/registry";
import { AI_ROLES } from "@/modules/core/schemas";
import { CAPABILITIES, CAPABILITY_KEYS } from "@/modules/ai/capabilities/catalog";
import { buildReadTools } from "@/modules/agents/tools";
import { queriesFor } from "@/modules/ai/assistant/catalog";
import { createTaskTool } from "@/modules/ai/assistant/tools";
import { teacherTools } from "@/modules/ai/agent/teacher-tools";
import { studentTools } from "@/modules/ai/agent/student-tools";
import { buildDraftTools } from "@/modules/ai/kernel/draft-tools";
import { buildChatToolset } from "@/modules/ai/kernel/handle-chat";
import { buildTaskTools } from "@/modules/ai/tasks/task-tools";
import type { TaskProposalOutput } from "@/modules/ai/tasks/types";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { buildContext, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceRecord,
  createAttendanceSession,
  createClassSection,
  createEnrolment,
  createGrade,
  createSubject,
  createSubjectAssignment,
  createTerm,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

// H = half day (counts 0.5), L = late (counts present).
const STATUSES = [
  { code: "P", label: "Present", counts_present: 1, in_denominator: true },
  { code: "H", label: "Half day", counts_present: 0.5, in_denominator: true },
  { code: "L", label: "Late", counts_present: 1, in_denominator: true },
  { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true },
];

const INJECTIONS = ["%", "_", ",", ")", "(", '"', "\\", "or=(id.not.is.null)", "a,first_name.ilike.*", "'; drop table students;--", "id.eq.1)"];
const LONG = "a".repeat(5_000);
const OPTS = { toolCallId: "c1", messages: [], context: {} } as never;

let A: TestInstitution;
let B: TestInstitution;
const ids = {} as Record<
  | "year" | "term2" | "g8" | "g10" | "g11" | "math" | "sci" | "s8a" | "s8b" | "s10a" | "s11a"
  | "aarav" | "aaravi" | "kabir" | "self" | "rohan" | "priya" | "hindi"
  | "unitRational" | "unitLinear" | "unitHindi" | "unitAcids" | "unitSets"
  | "bTerm" | "bStudent" | "bSection" | "bUnit" | "teacherStaff",
  string
>;
let today = "";

async function student(inst: string, first: string, last: string | null): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender)
    values (${inst}, ${`CB-${crypto.randomUUID().slice(0, 8)}`}, ${first}, ${last}, '2013-05-05', 'other')
    returning id
  `;
  return row.id as string;
}

async function unit(inst: string, subject: string, grade: string, title: string, sequence: number): Promise<string> {
  const [row] = await sql`
    insert into public.curriculum_units (institution_id, subject_id, grade_id, title, sequence)
    values (${inst}, ${subject}, ${grade}, ${title}, ${sequence}) returning id
  `;
  return row.id as string;
}

async function configure(institutionId: string): Promise<void> {
  const allOn = Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, true]));
  const roles = Object.fromEntries(AI_ROLES.map((r) => [r, { enabled: true, cloud: true, capabilities: allOn }]));
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object(
      'attendance', jsonb_build_object('mode', 'daily', 'correction_window_days', 3, 'statuses', ${sql.json(STATUSES)}::jsonb,
        'alert_thresholds', jsonb_build_object('warn', 80, 'critical', 75)),
      'features', jsonb_build_object('teacher_ai_agent', true, 'student_ai_study', true),
      'ai_roles', ${sql.json(roles)}::jsonb
    )
    where id = ${institutionId}
  `;
}

beforeAll(async () => {
  A = await createTestInstitution("orb-curve-a");
  B = await createTestInstitution("orb-curve-b");
  await configure(A.institutionId);
  await configure(B.institutionId);
  const a = A.institutionId;

  ids.year = await createAcademicYear(a, { startsOn: "2026-04-01", endsOn: "2027-03-31" });
  await createTerm(a, ids.year, { name: "Term 1", sequence: 1, startsOn: "2026-04-01", endsOn: "2026-09-30" });
  ids.term2 = await createTerm(a, ids.year, { name: "Term 2", sequence: 2, startsOn: "2026-10-01", endsOn: "2027-03-31" });
  ids.g8 = await createGrade(a, { code: "VIII", displayName: "Grade VIII", sortKey: 8 });
  ids.g10 = await createGrade(a, { code: "X", displayName: "Grade X", sortKey: 10, gradeGroup: "secondary" });
  ids.g11 = await createGrade(a, { code: "XI", displayName: "Grade XI", sortKey: 11, gradeGroup: "senior_secondary" });
  ids.math = await createSubject(a, { name: "Mathematics" });
  ids.sci = await createSubject(a, { name: "Science" });

  ids.teacherStaff = (await sql`select staff_id from public.memberships where institution_id = ${a} and user_id = ${A.users.teacher.id}`)[0]!
    .staff_id as string;
  ids.s8a = await createClassSection(a, ids.g8, ids.year, { name: "A", classTeacherId: ids.teacherStaff });
  ids.s8b = await createClassSection(a, ids.g8, ids.year, { name: "B" });
  ids.s10a = await createClassSection(a, ids.g10, ids.year, { name: "A" });
  ids.s11a = await createClassSection(a, ids.g11, ids.year, { name: "A" });
  await createSubjectAssignment(a, ids.s8a, ids.math, ids.teacherStaff);

  ids.aarav = await student(a, "Aarav", "Sharma");
  ids.aaravi = await student(a, "Aaravi", "Gupta");
  ids.kabir = await student(a, "Kabir", "Singh");
  ids.self = (await sql`select student_id from public.memberships where institution_id = ${a} and user_id = ${A.users.student.id}`)[0]!
    .student_id as string;
  ids.rohan = await student(a, "Rohan", "Verma");
  ids.priya = await student(a, "Priya", "Nair");
  ids.hindi = await student(a, "आरव", "कुमार");
  for (const [s, sec, roll] of [
    [ids.aarav, ids.s8a, 1], [ids.aaravi, ids.s8a, 2], [ids.kabir, ids.s8a, 3], [ids.self, ids.s8a, 4],
    [ids.rohan, ids.s8b, 1], [ids.priya, ids.s8b, 2], [ids.hindi, ids.s10a, 1],
  ] as const) {
    await createEnrolment(a, s, sec, ids.year, { rollNo: roll });
  }
  const guardianId = (await sql`select guardian_id from public.memberships where institution_id = ${a} and user_id = ${A.users.guardian.id}`)[0]!
    .guardian_id as string;
  await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary) values (${a}, ${guardianId}, ${ids.aarav}, 'father', true)`;

  ids.unitRational = await unit(a, ids.math, ids.g8, "Rational Numbers", 1);
  ids.unitLinear = await unit(a, ids.math, ids.g8, "Linear Equations in One Variable", 2);
  ids.unitHindi = await unit(a, ids.math, ids.g8, "भिन्न और दशमलव", 3);
  ids.unitAcids = await unit(a, ids.sci, ids.g8, "Acids, Bases and Salts", 1);
  ids.unitSets = await unit(a, ids.math, ids.g11, "Sets", 1);

  // Today's register: 8A has P, H, L, A; 8B two P; X-A and XI-A not taken.
  today = todayInInstitutionTimezone(await buildContext(A, "principal"));
  const s8aSession = await createAttendanceSession(a, ids.s8a, { date: today });
  await createAttendanceRecord(a, s8aSession, ids.aarav, { status: "P" });
  await createAttendanceRecord(a, s8aSession, ids.aaravi, { status: "H" });
  await createAttendanceRecord(a, s8aSession, ids.kabir, { status: "L" });
  await createAttendanceRecord(a, s8aSession, ids.self, { status: "A" });
  const s8bSession = await createAttendanceSession(a, ids.s8b, { date: today });
  await createAttendanceRecord(a, s8bSession, ids.rohan, { status: "P" });
  await createAttendanceRecord(a, s8bSession, ids.priya, { status: "P" });

  // Institution B: a look-alike school whose ids must never resolve in A.
  const b = B.institutionId;
  const bYear = await createAcademicYear(b);
  ids.bTerm = await createTerm(b, bYear, { startsOn: "2026-04-01", endsOn: "2027-03-31" });
  const bGrade = await createGrade(b, { code: "VIII", displayName: "Grade VIII", sortKey: 8 });
  ids.bSection = await createClassSection(b, bGrade, bYear, { name: "A" });
  ids.bStudent = await student(b, "Aarav", "Bee");
  await createEnrolment(b, ids.bStudent, ids.bSection, bYear);
  ids.bUnit = await unit(b, await createSubject(b, { name: "Mathematics" }), bGrade, "Rational Numbers", 1);
}, 120_000);

afterAll(async () => {
  setActingClient(null);
  await A?.cleanup();
  await B?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function as(role: FixtureRole, inst: TestInstitution = A): Promise<TenantContext> {
  const ctx = await buildContext(inst, role);
  setActingClient(inst.clientAs(role) as unknown as SupabaseClient<Database>);
  return ctx;
}

async function run(tools: ToolSet, name: string, input: unknown): Promise<unknown> {
  const t = tools[name] as { execute?: (i: unknown, o: unknown) => unknown } | undefined;
  if (!t?.execute) throw new Error(`no tool ${name}; have ${Object.keys(tools).join(", ")}`);
  return t.execute(input, OPTS);
}

/** A read tool's `<data-nonce>json</data-nonce>` payload, parsed. */
function data<T = Record<string, unknown>>(out: unknown): T {
  const m = /^<data-[^>]+>([\s\S]*)<\/data-[^>]+>$/.exec(String(out));
  if (!m) throw new Error(`not a data payload: ${String(out).slice(0, 200)}`);
  return JSON.parse(m[1]!) as T;
}

async function readTools(role: FixtureRole, inst: TestInstitution = A): Promise<ToolSet> {
  return (await buildReadTools(await as(role, inst), queriesFor(), "n0nce")).tools;
}

type SectionRow = { section: string; present: number; halfDay: number; absent: number; studentsMarked: number; percentage: number };

function allIntegers(obj: unknown, keys: readonly string[]): boolean {
  const walk = (v: unknown): boolean =>
    Array.isArray(v)
      ? v.every(walk)
      : v !== null && typeof v === "object"
        ? Object.entries(v).every(([k, x]) => (keys.includes(k) ? Number.isInteger(x) : walk(x)))
        : true;
  return walk(obj);
}

const COUNT_KEYS = ["present", "halfDay", "absent", "studentsMarked", "notCounted", "students", "totalActive", "presentCount", "absentCount", "lateCount"];

async function rowCount(table: string): Promise<number> {
  const [row] = await sql`select count(*)::int as n from ${sql(table)} where institution_id = ${A.institutionId}`;
  return row!.n as number;
}

// ── (1) scope + (2) numbers: assistant read tools ─────────────────────────

describe("assistant read tools: attendance and enrolment numbers vs DB truth", () => {
  it("principal: todayBySection gives class 8A its own whole-person counts, never the whole-school figures", async () => {
    const out = data<{ scope: string; sections: SectionRow[]; notTakenYet: string[] }>(await run(await readTools("principal"), "attendance_todayBySection", {}));
    expect(out.scope).toBe("whole school");
    const s8a = out.sections.find((s) => s.section === "VIII-A")!;
    expect(s8a).toMatchObject({ present: 2, halfDay: 1, absent: 1, studentsMarked: 4, percentage: 62.5 });
    expect(out.sections.find((s) => s.section === "VIII-B")).toMatchObject({ present: 2, absent: 0, studentsMarked: 2, percentage: 100 });
    expect(out.notTakenYet.sort()).toEqual(["X-A", "XI-A"]);
    expect(allIntegers(out, COUNT_KEYS)).toBe(true);

    const whole = data<SectionRow>(await run(await readTools("principal"), "attendance_attendanceTodaySummary", {}));
    expect(whole).toMatchObject({ present: 4, halfDay: 1, absent: 1, studentsMarked: 6, percentage: 75 });
    expect(whole.studentsMarked).not.toBe(s8a.studentsMarked);
  });

  it("teacher: todayBySection lists only their own class and says the rest are hidden, not zero", async () => {
    const out = data<{ scope: string; sections: SectionRow[]; notTakenYet: string[] }>(await run(await readTools("teacher"), "attendance_todayBySection", {}));
    expect(out.sections.map((s) => s.section)).toEqual(["VIII-A"]);
    expect(out.notTakenYet).toEqual([]);
    expect(out.scope).toMatch(/hidden from you, not zero/);
  });

  it("teacher attendanceTodaySummary is labelled 'whole school' but returns only the teacher's own class, with no scope note", async () => {
    const out = data<SectionRow & { scope?: string }>(await run(await readTools("teacher"), "attendance_attendanceTodaySummary", {}));
    // Either the real whole-school figures (6 marked) or an explicit "your classes only" scope.
    const honest = out.studentsMarked === 6 || (typeof out.scope === "string" && out.scope !== "whole school");
    expect(honest, JSON.stringify(out)).toBe(true);
  });

  it("principal: enrolmentCounts are whole people per class and add up to the total; an empty class shows 0 students", async () => {
    const out = data<{ totalActive: number; sections: { section: string; students: number }[] }>(await run(await readTools("principal"), "people_enrolmentCounts", {}));
    expect(Object.fromEntries(out.sections.map((s) => [s.section, s.students]))).toEqual({ "VIII-A": 4, "VIII-B": 2, "X-A": 1, "XI-A": 0 });
    expect(out.totalActive).toBe(7);
    expect(allIntegers(out, COUNT_KEYS)).toBe(true);
  });

  it("todayBySection: invalid, Hindi-numeral and malformed dates are refused as invalid input, never thrown", async () => {
    const tools = await readTools("principal");
    for (const date of ["2026-02-30", "२०२६-११-१२", "12/11/2026", "", "tomorrow", "2026-13-01"]) {
      const out = await run(tools, "attendance_todayBySection", { date });
      expect(String(out), date).toMatch(/^Query failed/);
    }
  });

  it("todayBySection: a far-future date marks every class not taken and invents no counts", async () => {
    const out = data<{ sections: SectionRow[]; notTakenYet: string[] }>(await run(await readTools("principal"), "attendance_todayBySection", { date: "2099-01-01" }));
    expect(out.sections).toEqual([]);
    expect(out.notTakenYet).toHaveLength(4);
  });

  it("getStudentAttendanceSummary: a half day is 0.5 of a marked day and the % stays within 0..100", async () => {
    const out = data<{ percentage: number; presentWeighted: number; totalInDenominator: number }>(
      await run(await readTools("principal"), "attendance_getStudentAttendanceSummary", { studentId: ids.aaravi }),
    );
    expect(out).toMatchObject({ presentWeighted: 0.5, totalInDenominator: 1, percentage: 50 });
  });

  it("getStudentAttendanceSummary for a student the teacher does not teach answers 0% instead of 'not yours'", async () => {
    const out = await run(await readTools("teacher"), "attendance_getStudentAttendanceSummary", { studentId: ids.rohan });
    // Rohan was present today: a 0% / 0-day answer is RLS-hidden data shown as a number.
    expect(String(out)).toMatch(/^Query failed/);
  });

  it("getStudentAttendanceSummary with another school's termId answers 0% instead of not_found", async () => {
    const out = await run(await readTools("principal"), "attendance_getStudentAttendanceSummary", { studentId: ids.aarav, termId: ids.bTerm });
    expect(String(out)).toMatch(/^Query failed/);
  });

  it("getStudentAttendanceSummary with no marked days says percentage 0 instead of none (null)", async () => {
    const out = data<{ percentage: number | null; totalInDenominator: number }>(
      await run(await readTools("principal"), "attendance_getStudentAttendanceSummary", { studentId: ids.hindi }),
    );
    expect(out.totalInDenominator).toBe(0);
    expect(out.percentage).toBeNull();
  });

  it("attendanceTodaySummary on a day nothing is marked says percentage 0 instead of none", async () => {
    // Institution B has sections but no register today.
    const out = data<SectionRow & { percentage: number | null }>(await run(await readTools("principal", B), "attendance_attendanceTodaySummary", {}));
    expect(out.studentsMarked).toBe(0);
    expect(out.percentage).toBeNull();
  });
});

// ── (3) inputs: student directory search ───────────────────────────────────

describe("assistant read tools: people.listStudents with fuzzy and hostile search text", () => {
  type Page = { students: { id: string; firstName: string }[]; total: number };

  it("partial, case-folded, full-name and Hindi names find the right people", async () => {
    const tools = await readTools("principal");
    const names = async (query: string) => data<Page>(await run(tools, "people_listStudents", { query, page: 1 })).students.map((s) => s.id).sort();
    expect(await names("Aarav")).toEqual([ids.aarav, ids.aaravi].sort());
    expect(await names("AARAV")).toEqual([ids.aarav, ids.aaravi].sort());
    expect(await names("aarav sharma")).toEqual([ids.aarav]);
    expect(await names("  aarav   sharma ")).toEqual([ids.aarav]);
    expect(await names("आरव")).toEqual([ids.hindi]);
  });

  it("PostgREST/SQL injection strings never error and never widen the match", async () => {
    const tools = await readTools("principal");
    for (const query of INJECTIONS) {
      const out = await run(tools, "people_listStudents", { query, page: 1 });
      expect(String(out), query).not.toMatch(/Query failed: internal/);
      if (String(out).startsWith("<data-")) expect(data<Page>(out).students.length, query).toBeLessThan(7);
    }
  });

  it("a lone '*' in a name search is a wildcard and lists every student", async () => {
    const out = data<Page>(await run(await readTools("principal"), "people_listStudents", { query: "*", page: 1 }));
    expect(out.students).toEqual([]);
  });

  it("over-long text, negative and zero pages are refused as invalid input", async () => {
    const tools = await readTools("principal");
    expect(String(await run(tools, "people_listStudents", { query: LONG, page: 1 }))).toMatch(/input was not valid/);
    expect(String(await run(tools, "people_listStudents", { query: "a", page: -1 }))).toMatch(/input was not valid/);
    expect(String(await run(tools, "people_listStudents", { query: "a", page: 0 }))).toMatch(/input was not valid/);
  });

  it("a huge page number fails with an internal error instead of an empty page", async () => {
    const out = await run(await readTools("principal"), "people_listStudents", { page: 1_000_000 });
    expect(String(out)).not.toMatch(/Query failed/);
    expect(data<Page>(out).students).toEqual([]);
  });

  it("another school's student id is not found and never listed", async () => {
    const tools = await readTools("principal");
    const profile = await run(tools, "people_getStudentProfile", { studentId: ids.bStudent });
    expect(String(profile)).toMatch(/Query failed: not_found|^<data-[^>]+>null</);
    const list = data<Page>(await run(tools, "people_listStudents", { query: "Bee", page: 1 }));
    expect(list.students).toEqual([]);
  });
});

// ── (1) guardian pinning through the chat toolset ─────────────────────────

describe("guardian chat: every student id is pinned to the verified child", () => {
  it("asking for another child's attendance answers with the guardian's own child", async () => {
    const ctx = await as("guardian");
    const { tools } = await buildChatToolset(ctx, { personaRole: "guardian", capabilities: ["child_attendance"], nonce: "g", childId: ids.aarav });
    const out = data<{ studentId: string }>(await run(tools, "attendance_getStudentAttendanceSummary", { studentId: ids.rohan, termId: ids.term2 }));
    expect(out.studentId).toBe(ids.aarav);
  });

  it("a guardian's own-child attendance (no termId, the normal call) always fails not_found", async () => {
    const ctx = await as("guardian");
    const { tools } = await buildChatToolset(ctx, { personaRole: "guardian", capabilities: ["child_attendance"], nonce: "g", childId: ids.aarav });
    const out = await run(tools, "attendance_getStudentAttendanceSummary", { studentId: ids.aarav });
    // Aarav was present today in the current term.
    expect(String(out)).not.toMatch(/Query failed/);
  });

  it("a student's own attendance (no termId) always fails not_found", async () => {
    const out = await run(await readTools("student"), "attendance_getStudentAttendanceSummary", { studentId: ids.self });
    expect(String(out)).not.toMatch(/Query failed/);
  });

  it("a guardian of two gets each child's own record, and never a child they are not linked to", async () => {
    const a = A.institutionId;
    const guardianId = (await sql`select guardian_id from public.memberships where institution_id = ${a} and user_id = ${A.users.guardian.id}`)[0]!
      .guardian_id as string;
    await sql`insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary) values (${a}, ${guardianId}, ${ids.aaravi}, 'father', false)`;
    try {
      const ctx = await as("guardian");
      const { tools } = await buildChatToolset(ctx, { personaRole: "guardian", capabilities: ["child_attendance"], nonce: "g", childIds: [ids.aarav, ids.aaravi] });
      for (const child of [ids.aarav, ids.aaravi]) {
        expect(data<{ studentId: string }>(await run(tools, "attendance_getStudentAttendanceSummary", { studentId: child, termId: ids.term2 })).studentId).toBe(child);
      }
      for (const other of [ids.rohan, ids.bStudent, undefined]) {
        const out = String(await run(tools, "attendance_getStudentAttendanceSummary", { studentId: other, termId: ids.term2 }));
        expect(out).toMatch(/one of this guardian's children/);
        expect(out).not.toContain(ids.rohan);
      }
    } finally {
      await sql`delete from public.guardian_students where institution_id = ${a} and guardian_id = ${guardianId} and student_id = ${ids.aaravi}`;
    }
  });

  it("a guardian's direct directory search never shows other families' children", async () => {
    const out = data<{ students: { id: string }[] }>(await run(await readTools("guardian"), "people_listStudents", { query: "Rohan", page: 1 }));
    expect(out.students).toEqual([]);
  });
});

// ── teacher agent tools ───────────────────────────────────────────────────

describe("teacher tools: scope", () => {
  it("findStudent finds only taught students; another class's student is 'no match'", async () => {
    const tools = (await teacherTools(await as("teacher"))) as unknown as ToolSet;
    expect(await run(tools, "findStudent", { query: "Rohan" })).toBe("No matching student found in your sections.");
    const aarav = (await run(tools, "findStudent", { query: "aarav" })) as { id: string }[];
    expect(aarav.map((s) => s.id).sort()).toEqual([ids.aarav, ids.aaravi].sort());
    for (const query of [...INJECTIONS, "आरव", "Bee"]) {
      const out = await run(tools, "findStudent", { query });
      expect(String(out), query).not.toMatch(/Something went wrong/);
      if (Array.isArray(out)) expect(out.map((s: { id: string }) => s.id), query).not.toContain(ids.rohan);
    }
  });

  it("getAttendancePattern / getExamResults / getAssignmentStatus refuse another class's and another school's student", async () => {
    const tools = (await teacherTools(await as("teacher"))) as unknown as ToolSet;
    for (const studentId of [ids.rohan, ids.bStudent]) {
      expect(await run(tools, "getAttendancePattern", { studentId })).toBe("That student is not in your sections, or has no active enrolment.");
      expect(await run(tools, "getExamResults", { studentId })).toBe("You do not teach this student.");
      expect(await run(tools, "getAssignmentStatus", { studentId })).toBe("You do not teach this student.");
    }
  });

  it("getAttendancePattern counts whole days only", async () => {
    const tools = (await teacherTools(await as("teacher"))) as unknown as ToolSet;
    const out = await run(tools, "getAttendancePattern", { studentId: ids.aarav });
    expect(out).toMatchObject({ presentCount: 1, absentCount: 0, lateCount: 0 });
    expect(allIntegers(out, COUNT_KEYS)).toBe(true);
  });

  it("getAttendancePattern counts a half day as a full absence", async () => {
    const tools = (await teacherTools(await as("teacher"))) as unknown as ToolSet;
    const out = (await run(tools, "getAttendancePattern", { studentId: ids.aaravi })) as { absentCount: number; recentAbsentDayOffsets: number[] };
    expect(out.absentCount).toBe(0);
  });

  it("getAttendancePattern never counts a late mark (code 'L') as late", async () => {
    const tools = (await teacherTools(await as("teacher"))) as unknown as ToolSet;
    const out = (await run(tools, "getAttendancePattern", { studentId: ids.kabir })) as { lateCount: number };
    expect(out.lateCount).toBe(1);
  });

  it("generateQuiz refuses a unit of a grade/subject the teacher does not teach and another school's unit, before any model call", async () => {
    const tools = (await teacherTools(await as("teacher"))) as unknown as ToolSet;
    for (const curriculumUnitId of [ids.unitSets, ids.unitAcids, ids.bUnit, crypto.randomUUID()]) {
      expect(await run(tools, "generateQuiz", { curriculumUnitId, difficulty: "easy", questionCount: 3 })).toBe("Curriculum unit not found, or not in your scope.");
    }
  });
});

describe("teacher tools: unit lookup with fuzzy and hostile text", () => {
  type Unit = { id: string; title: string };

  it("findCurriculumUnit matches word by word, in Hindi too, only within taught grade+subject", async () => {
    const tools = (await teacherTools(await as("teacher"))) as unknown as ToolSet;
    expect(((await run(tools, "findCurriculumUnit", { query: "rational number" })) as Unit[]).map((u) => u.id)).toEqual([ids.unitRational]);
    expect(((await run(tools, "findCurriculumUnit", { query: "chapter 2 linear equation" })) as Unit[]).map((u) => u.id)).toEqual([ids.unitLinear]);
    expect(((await run(tools, "findCurriculumUnit", { query: "भिन्न" })) as Unit[]).map((u) => u.id)).toEqual([ids.unitHindi]);
    // Science and grade XI are not taught: "not found" text, never the unit.
    expect(String(await run(tools, "findCurriculumUnit", { query: "acid bases and salts" }))).toMatch(/^No unit with that title/);
    expect(String(await run(tools, "findCurriculumUnit", { query: "sets" }))).toMatch(/^No unit with that title/);
  });

  it("findCurriculumUnit: injection and punctuation-only queries never error and never leak other units", async () => {
    const tools = (await teacherTools(await as("teacher"))) as unknown as ToolSet;
    for (const query of [...INJECTIONS, "class 8", "title.ilike.*", "x".repeat(200)]) {
      const out = await run(tools, "findCurriculumUnit", { query });
      expect(String(out), query).not.toMatch(/Something went wrong/);
      if (Array.isArray(out)) expect(out.map((u: Unit) => u.id), query).not.toContain(ids.unitSets);
    }
  });

  it("listMyUnits accepts 8, 8th, VIII, viii and 'class 8' for the grade", async () => {
    const tools = (await teacherTools(await as("teacher"))) as unknown as ToolSet;
    for (const grade of ["8", "8th", "VIII", "viii", "class 8", "Grade VIII"]) {
      const out = await run(tools, "listMyUnits", { grade });
      expect(Array.isArray(out) ? (out as Unit[]).map((u) => u.id).sort() : out, grade).toEqual([ids.unitRational, ids.unitLinear, ids.unitHindi].sort());
    }
    expect(String(await run(tools, "listMyUnits", { grade: "XI" }))).toMatch(/^No units found/);
  });

  it("listMyUnits finds nothing for a section-style class ('8A', 'VIII-A', '8 A')", async () => {
    const tools = (await teacherTools(await as("teacher"))) as unknown as ToolSet;
    for (const grade of ["8A", "VIII-A", "8 A"]) {
      expect(Array.isArray(await run(tools, "listMyUnits", { grade })), grade).toBe(true);
    }
  });

  it("listMyUnits finds nothing for a class said in words ('class eight')", async () => {
    const tools = (await teacherTools(await as("teacher"))) as unknown as ToolSet;
    expect(Array.isArray(await run(tools, "listMyUnits", { grade: "class eight" }))).toBe(true);
  });

  it("principal listMyUnits covers every grade (XI included)", async () => {
    const tools = (await teacherTools(await as("principal"))) as unknown as ToolSet;
    expect(((await run(tools, "listMyUnits", { grade: "XI" })) as Unit[]).map((u) => u.id)).toEqual([ids.unitSets]);
  });
});

// ── student study tools ───────────────────────────────────────────────────

describe("student tools", () => {
  it("findMyCurriculumUnit stays inside the student's own grade and treats % and _ literally", async () => {
    const tools = (await studentTools(await as("student"), { visualsEnabled: false })) as unknown as ToolSet;
    expect(Object.keys(tools)).toContain("findMyCurriculumUnit");
    expect(((await run(tools, "findMyCurriculumUnit", { query: "rational" })) as { id: string }[]).map((u) => u.id)).toEqual([ids.unitRational]);
    expect(await run(tools, "findMyCurriculumUnit", { query: "sets" })).toBe("No matching curriculum unit found in your grade.");
    for (const query of INJECTIONS) {
      const out = await run(tools, "findMyCurriculumUnit", { query });
      expect(String(out), query).not.toMatch(/Something went wrong/);
      if (Array.isArray(out)) expect(out.map((u: { id: string }) => u.id), query).not.toContain(ids.unitSets);
    }
  });

  it("findMyCurriculumUnit needs the exact phrase: 'acid bases and salts' misses 'Acids, Bases and Salts'", async () => {
    const tools = (await studentTools(await as("student"), { visualsEnabled: false })) as unknown as ToolSet;
    const out = await run(tools, "findMyCurriculumUnit", { query: "acid bases and salts" });
    expect(Array.isArray(out) ? (out as { id: string }[]).map((u) => u.id) : out).toEqual([ids.unitAcids]);
  });
});

// ── (3)+(4) propose_task: fuzzy refs, hostile values, and no direct writes ─

async function propose(ctx: TenantContext, task: string, values: Record<string, unknown>, extra: { childId?: string; after?: number } = {}) {
  const { tools } = buildTaskTools({ ctx, nonce: "t", texts: [task], childId: extra.childId });
  try {
    return { out: (await run(tools, "propose_task", { task, values, after: extra.after })) as TaskProposalOutput | string };
  } catch (threw) {
    return { threw };
  }
}

const card = (r: { out?: unknown; threw?: unknown }): TaskProposalOutput => {
  if (r.threw) throw new Error(`propose_task threw: ${String(r.threw)}`);
  if (typeof r.out === "string") throw new Error(`no card: ${r.out}`);
  return r.out as TaskProposalOutput;
};

describe("propose_task: class names said every way", () => {
  it("teacher: '8 a', 'VIII-A', '8A', 'class 8 A', 'viii a', 'Class VIII A' all resolve to their own 8A", async () => {
    const ctx = await as("teacher");
    for (const classSectionId of ["8 a", "VIII-A", "8A", "class 8 A", "viii a", "Class VIII A", ids.s8a]) {
      const view = card(await propose(ctx, "diary.entry.post", { classSectionId, entryDate: today, body: "Bring a ruler" })).view;
      expect(view.values.classSectionId, classSectionId).toBe(ids.s8a);
    }
  });

  it("'class eight A' (number in words) does not resolve to 8A", async () => {
    const ctx = await as("teacher");
    const view = card(await propose(ctx, "diary.entry.post", { classSectionId: "class eight A", entryDate: today, body: "x" })).view;
    expect(view.values.classSectionId).toBe(ids.s8a);
  });

  it("teacher: a class they do not teach, another school's section and hostile text are dropped, and the card still offers a section picker", async () => {
    const ctx = await as("teacher");
    for (const classSectionId of ["VIII-B", "8B", ids.s8b, ids.bSection, ...INJECTIONS, LONG]) {
      const view = card(await propose(ctx, "diary.entry.post", { classSectionId, entryDate: today, body: "x" })).view;
      expect(view.values.classSectionId, classSectionId.slice(0, 40)).toBeUndefined();
      expect(JSON.stringify(view.candidates), classSectionId.slice(0, 40)).not.toContain(ids.s8b);
      const field = view.fields.find((f) => f.path === "/classSectionId")!;
      expect(field).toMatchObject({ kind: "entity", entity: "classSection", required: true });
    }
  });

  it("principal: 'X A' picks X-A, not XI-A; '10a' does too", async () => {
    const ctx = await as("principal");
    for (const classSectionId of ["X A", "10a", "class 10 A"]) {
      const view = card(await propose(ctx, "diary.entry.post", { classSectionId, entryDate: today, body: "x" })).view;
      expect(view.values.classSectionId, classSectionId).toBe(ids.s10a);
    }
  });
});

describe("propose_task: student names", () => {
  it("principal: a partial name gives the closest matches as choices; a full name resolves; another school's id is dropped", async () => {
    const ctx = await as("principal");
    const base = { title: "Chess", category: "sports", level: "school", eventDate: today };
    const partial = card(await propose(ctx, "achievement.record", { ...base, studentId: "Aarav" })).view;
    expect(partial.values.studentId).toBeUndefined();
    expect((partial.candidates["/studentId"] ?? []).map((c) => c.id).sort()).toEqual([ids.aarav, ids.aaravi].sort());

    const full = card(await propose(ctx, "achievement.record", { ...base, studentId: "aarav sharma" })).view;
    expect(full.values.studentId).toBe(ids.aarav);

    for (const studentId of [ids.bStudent, "Bee", "%", ")", "or=(id.not.is.null)"]) {
      const view = card(await propose(ctx, "achievement.record", { ...base, studentId })).view;
      expect(view.values.studentId, studentId).toBeUndefined();
      expect(JSON.stringify(view.candidates), studentId).not.toContain(ids.bStudent);
    }
  });

  it("a Hindi (Devanagari) student name never resolves on a card, though the directory search finds it", async () => {
    const ctx = await as("principal");
    const view = card(await propose(ctx, "achievement.record", { studentId: "आरव", title: "Chess", category: "sports", level: "school", eventDate: today })).view;
    const offered = [view.values.studentId, ...(view.candidates["/studentId"] ?? []).map((c) => c.id)];
    expect(offered).toContain(ids.hindi);
  });

  it("guardian: studentLeave.request is pinned to their own child, whatever student the model named", async () => {
    const ctx = await as("guardian");
    for (const childId of [ids.aarav, undefined]) {
      const view = card(await propose(ctx, "studentLeave.request", { studentId: ids.rohan, startDate: today, endDate: today, reason: "Fever" }, { childId })).view;
      expect(view.values.studentId).toBe(ids.aarav);
    }
  });
});

describe("propose_task: hostile values and rule 6", () => {
  it("attendance.mark builds the register card from 8A's real roster and writes no attendance", async () => {
    const before = { records: await rowCount("attendance_records"), sessions: await rowCount("attendance_sessions"), proposals: await rowCount("ai_proposals") };
    const view = card(await propose(await as("teacher"), "attendance.mark", { classSectionId: "8a", date: "tomorrow", except: [{ student: "kabir", status: "absent" }] })).view;
    const records = view.values.records as { studentId: string; status: string }[];
    expect(records.map((r) => r.studentId).sort()).toEqual([ids.aarav, ids.aaravi, ids.kabir, ids.self].sort());
    expect(records.find((r) => r.studentId === ids.kabir)?.status).toBe("A");
    expect(await rowCount("attendance_records")).toBe(before.records);
    expect(await rowCount("attendance_sessions")).toBe(before.sessions);
    expect(await rowCount("ai_proposals")).toBe(before.proposals + 1);
  });

  it("attendance.mark with an impossible date (2026-02-30) throws out of the tool instead of returning text or a card", async () => {
    const r = await propose(await as("teacher"), "attendance.mark", { classSectionId: "8A", date: "2026-02-30" });
    expect(r.threw, String(r.threw)).toBeUndefined();
  });

  it("marks and payment tasks are not available to propose and leave no row behind", async () => {
    const ctx = await as("principal");
    const before = await rowCount("ai_proposals");
    for (const task of ["exam.marks.enter", "finance.payment.record", "finance.payment.void", "assignment.grade", "core.membership.role"]) {
      const r = await propose(ctx, task, { studentId: ids.aarav, marks: 100, amount: 5000 });
      expect(String(r.out), task).toMatch(/not available/);
    }
    expect(await rowCount("ai_proposals")).toBe(before);
  });

  it("an over-sized value gives a 'too large' message, not a thrown error; a bad 'after' is plain text", async () => {
    const ctx = await as("teacher");
    const big = await propose(ctx, "diary.entry.post", { classSectionId: "8A", entryDate: today, body: "x".repeat(400_000) });
    expect(big.threw).toBeUndefined();
    expect(String(big.out)).toMatch(/too large|Could not show/);
    const after = await propose(ctx, "diary.entry.post", { classSectionId: "8A", entryDate: today, body: "x" }, { after: 3 });
    expect(after.out).toBe("There is no card number 3 yet.");
  });

  it("an unknown or misspelled task name gives the closest real tasks, never a dead end", async () => {
    const r = await propose(await as("teacher"), "diary post", {});
    expect(String(r.out)).toMatch(/not available/);
    expect(String(r.out)).toContain("diary.entry.post");
  });
});

// ── (4)+(5) draft tools and the assistant's createTask ─────────────────────

describe("draft tools", () => {
  it("draft_announcement_create returns a draft and writes nothing", async () => {
    const ctx = await as("principal");
    const tools = await buildDraftTools(ctx, [CAPABILITIES.do_it_in_chat]);
    const before = await rowCount("announcements");
    const out = await run(tools, "draft_announcement_create", { title: "Holiday", body: "School closed Friday", audiences: [{ type: "school" }] });
    expect(out).toMatchObject({ kind: "action_draft", action: "announcement.create" });
    expect(await rowCount("announcements")).toBe(before);
  });

  it("draft_studentLeave_request rejects reversed dates as invalid input", async () => {
    const ctx = await as("guardian");
    const { tools } = await buildChatToolset(ctx, { personaRole: "guardian", capabilities: ["draft_leave_or_message"], nonce: "g", childId: ids.aarav });
    const out = await run(tools, "draft_studentLeave_request", { studentId: ids.rohan, startDate: "2026-11-20", endDate: "2026-11-10", reason: "Trip" });
    expect(String(out)).toMatch(/^Invalid input/);
    const ok = (await run(tools, "draft_studentLeave_request", { studentId: ids.rohan, startDate: today, endDate: today, reason: "Fever" })) as { input: { studentId: string } };
    expect(ok.input.studentId).toBe(ids.aarav);
  });

  it("draft_expenses_record carries the model's amount, though the orb card marks amount human-only (rule 6 money)", async () => {
    const ctx = await as("owner");
    const tools = await buildDraftTools(ctx, [CAPABILITIES.expenses_overview]);
    const out = (await run(tools, "draft_expenses_record", { categoryId: crypto.randomUUID(), amount: "5000", spentOn: today, note: "Chalk" })) as { input: Record<string, unknown> };
    expect(out.input.amount ?? out.input.amountPaise).toBeUndefined();
  });

  it("roles without the action's permission get no draft tool", async () => {
    const caps = [CAPABILITIES.do_it_in_chat, CAPABILITIES.expenses_overview, CAPABILITIES.draft_leave_or_message];
    for (const role of ["student", "guardian", "teacher"] as const) {
      const tools = await buildDraftTools(await as(role), caps);
      const names = Object.keys(tools);
      expect(names, role).not.toContain("draft_announcement_create");
      expect(names, role).not.toContain("draft_expenses_record");
    }
    expect(Object.keys(await buildDraftTools(await as("teacher"), caps))).not.toContain("draft_studentLeave_request");
  });
});

describe("permission gates on tool sets", () => {
  it("createTask exists exactly for roles holding insight.action's permission", async () => {
    await import("@/app/api/v1/actions/all-actions");
    const permission = getActionMeta().get("insight.action")!.permission as string;
    for (const role of ["owner", "principal", "admin", "teacher", "accountant", "student", "guardian"] as const) {
      const ctx = await as(role);
      expect((await createTaskTool(ctx)) !== null, role).toBe(hasPermission(ctx, permission as never));
    }
  });

  it("guardian and student read tools exclude staff-only and money queries", async () => {
    for (const role of ["guardian", "student"] as const) {
      const names = Object.keys(await readTools(role));
      for (const staffOnly of ["finance_listDefaulters", "people_staffAvailabilityToday", "exams_listSectionOptions", "core_approvals_pending"]) {
        expect(names, `${role} ${staffOnly}`).not.toContain(staffOnly);
      }
    }
  });

  it("no task tools for a role whose AI is switched off", async () => {
    const ctx = await as("teacher");
    const off: TenantContext = { ...ctx, institution: { ...ctx.institution, settings: { ...ctx.institution.settings, ai_roles: { teacher: { enabled: false } } } } };
    expect(buildTaskTools({ ctx: off, nonce: "n", texts: ["post a diary entry"] }).tools).toEqual({});
  });
});
