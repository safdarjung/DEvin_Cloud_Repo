import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (tests/db/dashboard-queries.test.ts precedent) so the query
// functions' own `createClient()` calls hit a real signed-in demo client.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import type { TenantContext } from "@/lib/auth/types";
import { pendingApprovals } from "@/modules/core/approvals.queries";
import { setActingClient } from "../helpers/server-client-mock";
import { buildDemoContext, closeDemoHelper, institutionId, sql, withModules } from "../helpers/demo-context";

// M16-T5 — reads the seeded `st-josephs-demo` tenant only; never writes.
const AGE = /^\d+ (h|d)$/;
const RECHECK_HREF = "/st-josephs-demo/exams/rechecks";

async function run(loginKey: string, role: Parameters<typeof buildDemoContext>[1], patch?: (ctx: TenantContext) => TenantContext) {
  const { ctx, client } = await buildDemoContext(loginKey, role);
  setActingClient(client);
  try {
    return await pendingApprovals(patch ? patch(ctx) : ctx);
  } finally {
    setActingClient(null);
  }
}

afterAll(async () => {
  await closeDemoHelper();
});

describe("core.approvals.pending (seeded demo tenant, real RLS)", () => {
  it("principal gets seeded pending leave rows first, then recheck rows matching the SQL count", async () => {
    const rows = await run("principal", "principal");
    const [{ leave }] = await sql!`
      select count(*)::int as leave from public.leave_requests
      where institution_id = ${institutionId} and status = 'pending'`;
    const [{ recheck }] = await sql!`
      select count(*)::int as recheck from public.recheck_requests
      where institution_id = ${institutionId} and status in ('submitted', 'under_review')`;
    expect(leave).toBeGreaterThan(0);
    expect(recheck).toBeGreaterThan(0);
    expect(rows.map((r) => r.kind)).toEqual([...Array(leave).fill("leave"), ...Array(recheck).fill("recheck")]);

    const leaveRows = rows.filter((r) => r.kind === "leave");
    expect(leaveRows.every((r) => /^[A-Z][a-z]+ leave, \d+ days?$/.test(r.title))).toBe(true);
    expect(leaveRows.every((r) => r.href === undefined)).toBe(true);

    const recheckRows = rows.filter((r) => r.kind === "recheck");
    expect(recheckRows.every((r) => r.href === RECHECK_HREF)).toBe(true);
    expect(recheckRows.every((r) => r.title.startsWith("Recheck: "))).toBe(true);
    expect(recheckRows.every((r) => !("reason" in r))).toBe(true);
    expect(rows.every((r) => AGE.test(r.age))).toBe(true);
  }, 20_000);

  it("exam_controller gets recheck rows only; accountant gets []", async () => {
    const controller = await run("examcontroller", "exam_controller");
    expect(controller.length).toBeGreaterThan(0);
    expect(controller.every((r) => r.kind === "recheck")).toBe(true);
    expect(await run("accountant", "accountant")).toEqual([]);
  }, 20_000);

  it("module off drops that source: staff_attendance → no leave, exams → no recheck", async () => {
    const noLeave = await run("principal", "principal", (ctx) => withModules(ctx, { staff_attendance: false }));
    expect(noLeave.length).toBeGreaterThan(0);
    expect(noLeave.every((r) => r.kind === "recheck")).toBe(true);
    const noRecheck = await run("principal", "principal", (ctx) => withModules(ctx, { exams: false }));
    expect(noRecheck.length).toBeGreaterThan(0);
    expect(noRecheck.every((r) => r.kind === "leave")).toBe(true);
  }, 20_000);
});
