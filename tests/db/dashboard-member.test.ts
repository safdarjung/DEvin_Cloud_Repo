// M16-T9 — teacherDashboard / portalDashboard over the seeded
// `st-josephs-demo` tenant (T2 helper, read-only). Signs in first, then
// fakes only `Date` to Mon 2026-10-26 10:00 IST (06 M16 rulings, "Clock in
// tests" — any weekday inside the seeded attendance window works for the
// composer-level checks here, which don't assert on specific trend values).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/auth/types";
import type { Database } from "@/lib/db/types";
import type { ActionResult } from "@/lib/actions/result";
import { getQueryMeta } from "@/lib/actions/define-query";
import { teacherDashboard, portalDashboard } from "@/modules/core/dashboard-member.queries";
import { studentDashboardQuery } from "@/modules/core/query-defs";
import { setActingClient } from "../helpers/server-client-mock";
import { buildDemoContext, closeDemoHelper, institutionId, sql, withModules } from "../helpers/demo-context";

let principal: { ctx: TenantContext; client: SupabaseClient<Database> };
let teacher: { ctx: TenantContext; client: SupabaseClient<Database> };
let guardian: { ctx: TenantContext; client: SupabaseClient<Database> };
let student: { ctx: TenantContext; client: SupabaseClient<Database> };

async function as<T>(
  who: { ctx: TenantContext; client: SupabaseClient<Database> },
  fn: (ctx: TenantContext) => Promise<T>,
): Promise<T> {
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
  student = await buildDemoContext("student.one", "student");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T04:30:00Z")); // Mon 10:00 IST
}, 30_000);

afterAll(async () => {
  vi.useRealTimers();
  await closeDemoHelper();
});

describe("M16-T9 dashboard.teacher (seeded demo tenant, real RLS)", () => {
  it("teacher.vi-a: timetable non-empty with a section subtitle, sectionsToday includes VI-A, counts are numbers", async () => {
    const { timetable, sectionsToday, papersToMark, activeAssignments } = await as(teacher, (ctx) => teacherDashboard(ctx));
    expect(timetable).not.toBeNull();
    expect(timetable!.length).toBeGreaterThan(0);
    expect(timetable!.some((period) => (period.subtitle?.length ?? 0) > 0)).toBe(true);
    expect(sectionsToday.some((section) => section.label === "VI-A")).toBe(true);
    expect(typeof papersToMark).toBe("number");
    expect(typeof activeAssignments).toBe("number");
  }, 20_000);

  it("module timetable off → timetable null", async () => {
    const { timetable } = await as(teacher, (ctx) => teacherDashboard(withModules(ctx, { timetable: false })));
    expect(timetable).toBeNull();
  }, 20_000);
});

describe("M16-T9 dashboard.parent / dashboard.student (seeded demo tenant, real RLS)", () => {
  it("guardian.one: parent dashboard for their own child has every field set, outstandingFees matches the SQL sum of unpaid invoice balances", async () => {
    const [{ student_id }] = await sql!`
      select student_id from public.guardian_students
      where institution_id = ${institutionId} and guardian_id = ${guardian.ctx.membership.guardianId}
      order by student_id limit 1
    `;
    const childId = student_id as string;

    const dashboard = await as(guardian, (ctx) => portalDashboard(ctx, childId));
    expect(dashboard.studentId).toBe(childId);
    expect(Array.isArray(dashboard.timetable)).toBe(true);
    expect(Array.isArray(dashboard.attendanceTrend)).toBe(true);
    expect(dashboard.attendance).not.toBeNull();
    expect(typeof dashboard.outstandingFees).toBe("number");
    expect(dashboard.upcomingAssignments === null || Array.isArray(dashboard.upcomingAssignments)).toBe(true);

    const invoiceRows = await sql!`
      select total::numeric as total, paid_total::numeric as paid_total
      from public.invoices
      where institution_id = ${institutionId} and student_id = ${childId} and status in ('issued', 'part_paid')
    `;
    const expectedPaise = invoiceRows.reduce(
      (sum, row) => sum + Math.round(Number(row.total) * 100) - Math.round(Number(row.paid_total) * 100),
      0,
    );
    expect(dashboard.outstandingFees).toBeCloseTo(expectedPaise / 100, 2);
  }, 20_000);

  it("another family's child → not_found (BOLA guard)", async () => {
    const [{ id: otherId }] = await sql!`
      select id from public.students where institution_id = ${institutionId} and first_name = 'Ishaan' and last_name = 'Mehta'
    `;
    await expect(as(guardian, (ctx) => portalDashboard(ctx, otherId as string))).rejects.toMatchObject({
      code: "not_found",
    });
  }, 20_000);

  it("{ exams: false } → latestResult null", async () => {
    const [{ student_id }] = await sql!`
      select student_id from public.guardian_students
      where institution_id = ${institutionId} and guardian_id = ${guardian.ctx.membership.guardianId}
      order by student_id limit 1
    `;
    const dashboard = await as(guardian, (ctx) =>
      portalDashboard(withModules(ctx, { exams: false }), student_id as string),
    );
    expect(dashboard.latestResult).toBeNull();
  }, 20_000);

  it("student.one: student dashboard returns their own studentId", async () => {
    const dashboard = await as(student, (ctx) => portalDashboard(ctx, ctx.membership.studentId as string));
    expect(dashboard.studentId).toBe(student.ctx.membership.studentId);
  }, 20_000);

  it("principal calling dashboard.student (no linked student record) → forbidden", async () => {
    const result = await as(principal, (ctx) =>
      studentDashboardQuery(ctx.institution.slug, {}, ctx) as Promise<ActionResult<unknown>>,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  }, 20_000);
});

describe("M16-T9 query defs", () => {
  it("dashboard.teacher, dashboard.parent, dashboard.student are registered, module core", () => {
    const expected: Record<string, string> = {
      "dashboard.teacher": "attendance.mark",
      "dashboard.parent": "student.read",
      "dashboard.student": "student.read",
    };
    for (const [name, permission] of Object.entries(expected)) {
      const meta = getQueryMeta().get(name);
      expect(meta, name).toBeDefined();
      expect(meta!.permission).toBe(permission);
      expect(meta!.module).toBe("core");
    }
  });
});
