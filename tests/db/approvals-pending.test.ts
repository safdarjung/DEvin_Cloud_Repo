import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

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

// M19-T20 — pending-approval insight row. Planted via record_insights
// (service role, same shape as tests/db/insight-queries.test.ts) and
// cleaned up after each test: `insights` is not in CLAUDE.md rule 5's
// immutable-history list, and this is a test fixture, not app code.
function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

const plantedDedupeKeys: string[] = [];

afterEach(async () => {
  if (plantedDedupeKeys.length === 0) return;
  await sql!`delete from public.insights where dedupe_key = any(${plantedDedupeKeys})`;
  plantedDedupeKeys.length = 0;
});

async function plantApprovalInsight(): Promise<string> {
  const dedupeKey = `dk-t20-${crypto.randomUUID()}`;
  plantedDedupeKeys.push(dedupeKey);
  const row = {
    signal: "finance.overdue_growth",
    detector_version: 1,
    dedupe_key: dedupeKey,
    domain: "finance",
    kind: "descriptive",
    severity: "critical",
    title: "Overdue fees rising",
    pattern: "Overdue fees rose sharply in the last 4 weeks.",
    evidence: [{ label: "Overdue now", value: 2000 }],
    sources: [],
    date_from: "2026-09-01",
    date_to: "2026-10-01",
    confidence: 0.6,
    factors: [],
    reviewer_role: "accountant",
    recommended_actions: [],
    approval_required: true,
    entity_type: null,
    entity_id: null,
    entity_label: null,
    class_section_id: null,
  };
  const { error } = await adminClient().rpc("record_insights", { p_institution_id: institutionId, p_rows: [row] });
  if (error) throw error;
  const [inserted] = await sql!`select id from public.insights where institution_id = ${institutionId} and dedupe_key = ${dedupeKey}`;
  return inserted.id as string;
}

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

  // M19-T20
  it("principal with a critical open insight gets one insight row, after the recheck rows", async () => {
    const insightId = await plantApprovalInsight();
    const rows = await run("principal", "principal");
    expect(rows.map((r) => r.kind).filter((k) => k !== "leave" && k !== "recheck")).toEqual(["insight"]);
    const lastIndex = rows.length - 1;
    expect(rows[lastIndex]).toMatchObject({
      id: insightId,
      kind: "insight",
      title: "Insight: Overdue fees rising",
      requestedBy: "Insights engine",
      href: `/st-josephs-demo/fabric/insights?id=${insightId}`,
    });
    expect(AGE.test(rows[lastIndex].age)).toBe(true);
  }, 20_000);

  it("insights module off → no insight rows", async () => {
    await plantApprovalInsight();
    const rows = await run("principal", "principal", (ctx) => withModules(ctx, { insights: false }));
    expect(rows.some((r) => r.kind === "insight")).toBe(false);
  }, 20_000);

  it("accountant sees the finance insight row only (no leave/recheck permission)", async () => {
    const insightId = await plantApprovalInsight();
    const rows = await run("accountant", "accountant");
    expect(rows).toEqual([
      expect.objectContaining({ id: insightId, kind: "insight" }),
    ]);
  }, 20_000);

  it("teacher gets no insight row (no insight.review permission)", async () => {
    await plantApprovalInsight();
    const teacher = await run("teacher.vi-a", "teacher");
    expect(teacher.some((r) => r.kind === "insight")).toBe(false);
  }, 20_000);
});
