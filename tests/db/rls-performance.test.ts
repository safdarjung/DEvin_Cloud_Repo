import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// P-01 (lead packet, not in original backlog). Reads the already-seeded
// demo tenant — run `pnpm db:reset` (or `pnpm demo:reset`) before this file,
// not inside it (seeding ~181k attendance records is too slow to redo per
// test run; see CLAUDE.md "Run only your packet's targeted tests").
//
// Before the 20261028000020_rls_performance.sql fix, `count(*)` through
// RLS on this tenant measured: principal sessions 0.18s/records 7.9s,
// teacher sessions 15.7s/records >30s (timeout), guardian sessions
// 25.5s/records >30s, admissions sessions 17s (0 rows)/records >30s.
// Threshold is generous (1s) to avoid flaking under full-suite load while
// still catching a regression back to per-row SECURITY DEFINER calls.

const PERF_THRESHOLD_MS = 1000;

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";

let institutionId: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm db:reset` first.");
  institutionId = row.id as string;
});

afterAll(async () => {
  await sql.end();
});

async function signInDemo(loginKey: string) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error } = await client.auth.signInWithPassword({
    email: `${loginKey}@demo.coolskool.test`,
    password: SEED_PASSWORD,
  });
  if (error) throw error;
  return client;
}

/** Real count(*) through RLS via a HEAD request (Prefer: count=exact, no row data), timed. */
async function timedRlsCount(
  client: Awaited<ReturnType<typeof signInDemo>>,
  table: "attendance_sessions" | "attendance_records",
): Promise<{ count: number; ms: number }> {
  const start = performance.now();
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  const ms = performance.now() - start;
  if (error) throw error;
  return { count: count ?? 0, ms };
}

/** Independent reference counts, computed from the domain tables directly
 * (not by reusing the RLS helpers under test), so this test doesn't just
 * check the policy against itself. */
async function expectedCountsFor(loginKey: "principal" | "teacher.vi-a" | "guardian.one" | "admissions") {
  if (loginKey === "principal") {
    const [sessions] = await sql`select count(*)::int as n from public.attendance_sessions where institution_id = ${institutionId}`;
    const [records] = await sql`select count(*)::int as n from public.attendance_records where institution_id = ${institutionId}`;
    return { sessions: sessions.n as number, records: records.n as number };
  }

  if (loginKey === "admissions") {
    return { sessions: 0, records: 0 };
  }

  const [user] = await sql`select id from auth.users where email = ${`${loginKey}@demo.coolskool.test`}`;
  const [membership] = await sql`
    select staff_id, guardian_id from public.memberships
    where institution_id = ${institutionId} and user_id = ${user.id} and status = 'active'
  `;

  if (loginKey === "teacher.vi-a") {
    const sectionIds = await sql`
      select cs.id from public.class_sections cs
      where cs.institution_id = ${institutionId}
        and (
          cs.class_teacher_id = ${membership.staff_id}
          or exists (
            select 1 from public.subject_assignments sa
            where sa.class_section_id = cs.id and sa.teacher_id = ${membership.staff_id}
          )
        )
    `;
    const ids = sectionIds.map((r) => r.id as string);
    const [sessions] = await sql`
      select count(*)::int as n from public.attendance_sessions
      where institution_id = ${institutionId} and class_section_id = any(${ids})
    `;
    const [records] = await sql`
      select count(*)::int as n from public.attendance_records r
      join public.attendance_sessions s on s.id = r.session_id
      where r.institution_id = ${institutionId} and s.class_section_id = any(${ids})
    `;
    return { sessions: sessions.n as number, records: records.n as number };
  }

  // guardian.one
  const studentIds = await sql`
    select student_id from public.guardian_students where guardian_id = ${membership.guardian_id}
  `;
  const sids = studentIds.map((r) => r.student_id as string);
  const [records] = await sql`
    select count(*)::int as n from public.attendance_records
    where institution_id = ${institutionId} and student_id = any(${sids})
  `;
  const [sessions] = await sql`
    select count(*)::int as n from public.attendance_sessions s
    where institution_id = ${institutionId}
      and exists (
        select 1 from public.enrolments e
        where e.class_section_id = s.class_section_id and e.status = 'active' and e.student_id = any(${sids})
      )
  `;
  return { sessions: sessions.n as number, records: records.n as number };
}

describe("P-01 RLS performance — attendance count(*) on the seeded demo tenant", () => {
  const cases = ["principal", "teacher.vi-a", "guardian.one", "admissions"] as const;

  for (const loginKey of cases) {
    it(`${loginKey}: attendance_sessions/attendance_records count(*) completes under ${PERF_THRESHOLD_MS}ms with the expected row counts`, async () => {
      const client = await signInDemo(loginKey);
      const expected = await expectedCountsFor(loginKey);

      const sessions = await timedRlsCount(client, "attendance_sessions");
      const records = await timedRlsCount(client, "attendance_records");

      expect(sessions.ms).toBeLessThan(PERF_THRESHOLD_MS);
      expect(records.ms).toBeLessThan(PERF_THRESHOLD_MS);
      expect(sessions.count).toBe(expected.sessions);
      expect(records.count).toBe(expected.records);
    }, 20_000);
  }
});
