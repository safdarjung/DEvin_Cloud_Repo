// M16-T4 — attendanceDailyCounts / attendanceTrend / attendanceTodaySummary
// over the seeded `st-josephs-demo` tenant (T2 helper, read-only). Signs in
// first, then fakes only `Date` to 2026-10-28 12:00 IST — the last seeded
// attendance day (scripts/seed/sections/attendance.ts) — so "today" and the
// trend window land inside the seeded range (06 M16 rulings, "Clock in tests").
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/auth/types";
import type { Database } from "@/lib/db/types";
import {
  attendanceDailyCounts,
  attendanceTodaySummary,
  attendanceTrend,
  type TrendPoint,
} from "@/modules/attendance/queries";
import { setActingClient } from "../helpers/server-client-mock";
import { buildDemoContext, closeDemoHelper, institutionId, sql } from "../helpers/demo-context";

const TODAY = "2026-10-28";
const label = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const windowStart = (days: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
};

/** Weighted % straight from SQL (settings status weights), independent of the TS math under test. */
async function sqlPercentage(
  from: string,
  to: string,
  scope: { studentId?: string; classSectionId?: string } = {},
): Promise<number> {
  const [row] = await sql!`
    with w as (
      select s->>'code' as code, (s->>'counts_present')::numeric as cp, (s->>'in_denominator')::boolean as ind
      from public.institutions i, jsonb_array_elements(i.settings->'attendance'->'statuses') s
      where i.id = ${institutionId}
    )
    select coalesce(round(100 * sum(w.cp) / count(*), 2), 0)::float as pct
    from public.attendance_records r
    join public.attendance_sessions se on se.id = r.session_id
    join w on w.code = r.status
    where r.institution_id = ${institutionId} and se.period_id is null and w.ind
      and se.date between ${from} and ${to}
      and (${scope.studentId ?? null}::uuid is null or r.student_id = ${scope.studentId ?? null}::uuid)
      and (${scope.classSectionId ?? null}::uuid is null or se.class_section_id = ${scope.classSectionId ?? null}::uuid)
  `;
  return row.pct as number;
}

/** Distinct school dates with at least one in-denominator record, for ground-truth date-list checks. */
async function sqlTrendDates(from: string, to: string, classSectionId: string): Promise<string[]> {
  const rows = await sql!`
    with w as (
      select s->>'code' as code, (s->>'in_denominator')::boolean as ind
      from public.institutions i, jsonb_array_elements(i.settings->'attendance'->'statuses') s
      where i.id = ${institutionId}
    )
    select distinct se.date::text as date
    from public.attendance_records r
    join public.attendance_sessions se on se.id = r.session_id
    join w on w.code = r.status
    where r.institution_id = ${institutionId} and se.period_id is null and w.ind
      and se.class_section_id = ${classSectionId}
      and se.date between ${from} and ${to}
    order by 1
  `;
  return rows.map((r) => r.date as string);
}

let principal: { ctx: TenantContext; client: SupabaseClient<Database> };
let teacher: { ctx: TenantContext; client: SupabaseClient<Database> };
let guardian: { ctx: TenantContext; client: SupabaseClient<Database> };

async function as<T>(who: { ctx: TenantContext; client: SupabaseClient<Database> }, fn: (ctx: TenantContext) => Promise<T>): Promise<T> {
  setActingClient(who.client);
  try {
    return await fn(who.ctx);
  } finally {
    setActingClient(null);
  }
}

beforeAll(async () => {
  principal = await buildDemoContext("principal", "principal");
  teacher = await buildDemoContext("teacher.vi-a", "teacher");
  guardian = await buildDemoContext("guardian.one", "guardian");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T06:30:00Z")); // 12:00 IST
}, 30_000);

afterAll(async () => {
  vi.useRealTimers();
  await closeDemoHelper();
});

describe("M16-T4 attendance aggregate reads (seeded demo tenant, real RLS)", () => {
  it("principal attendanceDailyCounts for today sums to the SQL count(*) — over 1000, so no max_rows truncation", async () => {
    const rows = await as(principal, (ctx) => attendanceDailyCounts(ctx, { from: TODAY, to: TODAY }));
    const [{ n }] = await sql!`
      select count(*)::int as n from public.attendance_records r
      join public.attendance_sessions s on s.id = r.session_id
      where r.institution_id = ${institutionId} and s.period_id is null and s.date = ${TODAY}
    `;
    expect(n).toBeGreaterThan(1000);
    expect(rows.reduce((sum, r) => sum + r.n, 0)).toBe(n);
    expect(rows.every((r) => r.date === TODAY && r.classSectionId === null)).toBe(true);
  }, 20_000);

  it("attendanceTodaySummary equals the SQL-computed weighted %", async () => {
    const summary = await as(principal, (ctx) => attendanceTodaySummary(ctx));
    expect(summary.date).toBe(TODAY);
    expect(summary.percentage).toBeCloseTo(await sqlPercentage(TODAY, TODAY), 1);
  }, 20_000);

  it("attendanceTrend({ days: 30 }) — one ascending point per seeded school day, values 0–100, labels like '28 Oct'", async () => {
    const trend = await as(principal, (ctx) => attendanceTrend(ctx, { days: 30 }));
    const dates = await sql!`
      select distinct s.date::text as date from public.attendance_sessions s
      where s.institution_id = ${institutionId} and s.period_id is null
        and s.date between ${windowStart(30)} and ${TODAY}
        and exists (select 1 from public.attendance_records r where r.session_id = s.id)
      order by 1
    `;
    expect(dates.length).toBeGreaterThan(0);
    expect(trend.map((p) => p.label)).toEqual(dates.map((d) => label(d.date as string)));
    expect(trend.at(-1)?.label).toBe("28 Oct");
    for (const p of trend) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(100);
      expect(p.value).toBe(Math.round(p.value * 10) / 10);
    }
  }, 20_000);

  it("teacher.vi-a with classSectionId = VI-A gets that section's own daily % (narrower than their unscoped, multi-section RLS view)", async () => {
    const [{ id }] = await sql!`
      select cs.id from public.class_sections cs join public.grades g on g.id = cs.grade_id
      where cs.institution_id = ${institutionId} and g.code = 'VI' and cs.name = 'A'
    `;
    const sectionId = id as string;
    const scoped = await as(teacher, (ctx) => attendanceTrend(ctx, { days: 30, classSectionId: sectionId }));
    const unscoped = await as(teacher, (ctx) => attendanceTrend(ctx, { days: 30 }));
    const dates = await sqlTrendDates(windowStart(30), TODAY, sectionId);

    // RLS (app.teaches_section) also covers this teacher's other subject-assignment
    // sections (06 rulings "Scope: ... teacher: own sections", plural), so the
    // unscoped view is a superset, not an exact match — ground truth per date is.
    expect(scoped.map((p) => p.label)).toEqual(dates.map((d) => label(d)));
    for (let i = 0; i < dates.length; i++) {
      expect(scoped[i].value).toBeCloseTo(await sqlPercentage(dates[i], dates[i], { classSectionId: sectionId }), 1);
    }
    expect(unscoped.length).toBeGreaterThanOrEqual(scoped.length);
  }, 20_000);

  it("guardian.one gets a running % for their own child; another family's child → []", async () => {
    const [{ student_id }] = await sql!`
      select student_id from public.guardian_students
      where institution_id = ${institutionId} and guardian_id = ${guardian.ctx.membership.guardianId}
      order by student_id limit 1
    `;
    const own = await as(guardian, (ctx) => attendanceTrend(ctx, { days: 30, studentId: student_id as string }));
    expect(own.length).toBeGreaterThan(1);
    const last = own.at(-1) as TrendPoint;
    expect(last.value).toBeCloseTo(await sqlPercentage(windowStart(30), TODAY, { studentId: student_id as string }), 1);

    const [{ id: other }] = await sql!`
      select id from public.students where institution_id = ${institutionId} and first_name = 'Ishaan' and last_name = 'Mehta'
    `;
    expect(await as(guardian, (ctx) => attendanceTrend(ctx, { days: 30, studentId: other as string }))).toEqual([]);
  }, 20_000);
});
