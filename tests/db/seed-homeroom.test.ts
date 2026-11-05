import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// X01-T12 (seed section `homeroom`). Reads the already-seeded demo tenant
// (same convention as tests/db/seed-ptm.test.ts) — run `pnpm demo:reset`
// before this file; the last test triggers its own reseed to check
// determinism.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const repoRoot = path.resolve(import.meta.dirname, "../..");

function runDemoReset(): void {
  execFileSync("node", ["--env-file-if-exists=.env.local", "scripts/demo-reset.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DEMO_RESET_ALLOWED: "true" },
    stdio: "pipe",
  });
}

function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function isodow(iso: string): number {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const d0 = isodow(todayIST()) <= 6 ? todayIST() : addDays(todayIST(), 1);
const d1 = (() => {
  let cursor = addDays(d0, 1);
  while (isodow(cursor) === 7) cursor = addDays(cursor, 1);
  return cursor;
})();

let institutionId: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
  institutionId = row.id as string;
}, 180_000);

afterAll(async () => {
  await sql.end();
});

async function studentIdFor(firstName: string, lastName: string, gradeCode: string, sectionName: string): Promise<string> {
  const [row] = await sql`
    select s.id
    from public.students s
    join public.enrolments e on e.student_id = s.id and e.status = 'active'
    join public.class_sections cs on cs.id = e.class_section_id
    join public.grades g on g.id = cs.grade_id
    where s.institution_id = ${institutionId} and s.first_name = ${firstName} and s.last_name = ${lastName}
      and g.code = ${gradeCode} and cs.name = ${sectionName}
  `;
  if (!row) throw new Error(`student ${firstName} ${lastName} (${gradeCode}-${sectionName}) not found`);
  return row.id as string;
}

async function userIdForEmail(email: string): Promise<string> {
  const [row] = await sql`select id from auth.users where email = ${email}`;
  if (!row) throw new Error(`auth user for ${email} not found`);
  return row.id as string;
}

describe("X01-T12 seed section homeroom", () => {
  it("has a pending leave for Aarav starting d1 (after today), reason 'Family function'", async () => {
    const aaravId = await studentIdFor("Aarav", "Sharma", "VI", "A");
    const rows = await sql`
      select status, start_date::text as start_date, end_date::text as end_date, reason, decided_by
      from public.student_leave_requests
      where institution_id = ${institutionId} and student_id = ${aaravId}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.start_date).toBe(d1);
    expect(rows[0]!.end_date).toBe(d1);
    expect(rows[0]!.reason).toBe("Family function");
    expect(rows[0]!.decided_by).toBeNull();
  });

  it("has a rejected leave for Ishaan decided by teacher.viii-b", async () => {
    const ishaanId = await studentIdFor("Ishaan", "Mehta", "VIII", "B");
    const teacherId = await userIdForEmail("teacher.viii-b@demo.coolskool.test");
    const rows = await sql`
      select status, decided_by from public.student_leave_requests
      where institution_id = ${institutionId} and student_id = ${ishaanId}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe("rejected");
    expect(rows[0]!.decided_by).toBe(teacherId);
  });

  it("has one approved leave for a non-named VI-A student, dated June 2026", async () => {
    const aaravId = await studentIdFor("Aarav", "Sharma", "VI", "A");
    const rows = await sql`
      select slr.student_id, slr.start_date::text as start_date, slr.end_date::text as end_date
      from public.student_leave_requests slr
      join public.class_sections cs on cs.id = slr.class_section_id
      join public.grades g on g.id = cs.grade_id
      where slr.institution_id = ${institutionId} and slr.status = 'approved'
        and g.code = 'VI' and cs.name = 'A'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.student_id).not.toBe(aaravId);
    expect(rows[0]!.start_date.startsWith("2026-06")).toBe(true);
    expect(rows[0]!.end_date.startsWith("2026-06")).toBe(true);
  });

  it("VI-A's d0 PTM note is unacknowledged for Aarav; VIII-B's is acknowledged for Ishaan", async () => {
    const aaravId = await studentIdFor("Aarav", "Sharma", "VI", "A");
    const ishaanId = await studentIdFor("Ishaan", "Mehta", "VIII", "B");
    const guardianTwoId = await userIdForEmail("guardian.two@demo.coolskool.test");

    const [viANote] = await sql`
      select e.id from public.diary_entries e
      join public.class_sections cs on cs.id = e.class_section_id
      join public.grades g on g.id = cs.grade_id
      where e.institution_id = ${institutionId} and g.code = 'VI' and cs.name = 'A'
        and e.entry_date = ${d0} and e.subject_id is null and e.requires_ack = true
    `;
    expect(viANote).toBeTruthy();
    const viAAck = await sql`
      select 1 from public.diary_acknowledgements where entry_id = ${viANote.id} and student_id = ${aaravId}
    `;
    expect(viAAck.length).toBe(0);

    const [viiiBNote] = await sql`
      select e.id from public.diary_entries e
      join public.class_sections cs on cs.id = e.class_section_id
      join public.grades g on g.id = cs.grade_id
      where e.institution_id = ${institutionId} and g.code = 'VIII' and cs.name = 'B'
        and e.entry_date = ${d0} and e.subject_id is null and e.requires_ack = true
    `;
    expect(viiiBNote).toBeTruthy();
    const viiiBAck = await sql`
      select acknowledged_by from public.diary_acknowledgements
      where entry_id = ${viiiBNote.id} and student_id = ${ishaanId}
    `;
    expect(viiiBAck.length).toBe(1);
    expect(viiiBAck[0]!.acknowledged_by).toBe(guardianTwoId);
  });

  it("has 15 diary_entries for VI-A/VIII-B/X-A and created no notify.diary_entry jobs", async () => {
    const rows = await sql`
      select e.id from public.diary_entries e
      join public.class_sections cs on cs.id = e.class_section_id
      join public.grades g on g.id = cs.grade_id
      where e.institution_id = ${institutionId}
        and (g.code, cs.name) in (('VI', 'A'), ('VIII', 'B'), ('X', 'A'))
    `;
    expect(rows.length).toBe(15);

    const jobs = await sql`
      select 1 from public.jobs where institution_id = ${institutionId} and type = 'notify.diary_entry'
    `;
    expect(jobs.length).toBe(0);
  });

  it("writes no attendance session dated after today", async () => {
    const rows = await sql`
      select 1 from public.attendance_sessions
      where institution_id = ${institutionId} and date > ${d0}
    `;
    expect(rows.length).toBe(0);
  });

  it("reseed gives identical leave/diary/acknowledgement ids", async () => {
    const fingerprint = async (inst: string) => ({
      leave: (await sql`select id from public.student_leave_requests where institution_id = ${inst} order by id`).map(
        (r) => r.id as string,
      ),
      diary: (await sql`select id from public.diary_entries where institution_id = ${inst} order by id`).map(
        (r) => r.id as string,
      ),
      acks: (
        await sql`select id from public.diary_acknowledgements where institution_id = ${inst} order by id`
      ).map((r) => r.id as string),
    });

    const before = await fingerprint(institutionId);
    expect(before.leave.length).toBeGreaterThan(0);
    expect(before.diary.length).toBe(15);
    expect(before.acks.length).toBeGreaterThan(0);

    runDemoReset();

    const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    const after = await fingerprint(row!.id as string);
    expect(after).toEqual(before);
  }, 180_000);
});
