import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// M08-T13 (seed section `staffing`). Reads the already-seeded demo tenant —
// run `pnpm demo:reset` before this file (same convention as
// tests/db/seed-timetable.test.ts); the last test triggers its own reseed
// to check id determinism, mirroring tests/db/seed-determinism.test.ts.

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

let institutionId: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
  institutionId = row.id as string;
}, 180_000);

afterAll(async () => {
  await sql.end();
});

describe("M08-T13 seed section staffing", () => {
  it("has an approved leave covering d0 with an assigned substitution", async () => {
    const rows = await sql`
      select s.id as substitution_id, lr.status
      from public.leave_requests lr
      join public.substitutions s on s.leave_request_id = lr.id and s.status = 'assigned'
      where lr.institution_id = ${institutionId}
        and lr.status = 'approved'
        and lr.start_date <= ${d0} and lr.end_date >= ${d0}
    `;
    expect(rows.length).toBe(1);
  });

  it("has at least 3 pending leave requests", async () => {
    const rows = await sql`
      select id from public.leave_requests where institution_id = ${institutionId} and status = 'pending'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("never double-books an assigned substitute (date, period)", async () => {
    const rows = await sql`
      select substitute_teacher_id, date, period_id, count(*)::int as n
      from public.substitutions
      where institution_id = ${institutionId} and status = 'assigned'
      group by substitute_teacher_id, date, period_id
      having count(*) > 1
    `;
    expect(rows.length).toBe(0);
  });

  it("has staff_attendance rows for the most recent school day before d0", async () => {
    const priorSchoolDay = (() => {
      let cursor = addDays(d0, -1);
      while (isodow(cursor) === 7) cursor = addDays(cursor, -1);
      return cursor;
    })();
    const rows = await sql`
      select id from public.staff_attendance where institution_id = ${institutionId} and date = ${priorSchoolDay}
    `;
    expect(rows.length).toBeGreaterThan(0);
  });

  it("gives identical leave/attendance/substitution ids across a reset + reseed", async () => {
    const fingerprint = async (inst: string) => ({
      leave: (await sql`select id from public.leave_requests where institution_id = ${inst} order by id`).map(
        (r) => r.id as string,
      ),
      attendance: (
        await sql`select id from public.staff_attendance where institution_id = ${inst} order by id`
      ).map((r) => r.id as string),
      substitutions: (await sql`select id from public.substitutions where institution_id = ${inst} order by id`).map(
        (r) => r.id as string,
      ),
    });

    const before = await fingerprint(institutionId);
    expect(before.leave.length).toBeGreaterThan(0);

    runDemoReset();

    const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    const after = await fingerprint(row!.id as string);
    expect(after).toEqual(before);
  }, 180_000);
});
