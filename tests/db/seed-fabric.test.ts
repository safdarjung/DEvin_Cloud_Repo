// M27-T2 — seed section `fabric` part 1 (insights, lifecycle, interventions).
// Reads the already-seeded demo tenant — `beforeAll` runs its own
// `demo:reset` (same convention as tests/db/seed-staffing.test.ts). Named
// dedupe_keys below were copied from a real run against this tenant (M27-T2
// report) — rulings "Lifecycle picks": pin the picked insights, don't
// re-derive them from `pickLifecycleTargets` alone, so a detector/signal
// change breaks this test loudly instead of silently agreeing with itself.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// M27-T3 — `pendingApprovals` (src/modules/core/approvals.queries.ts) calls
// `createClient()` from "@/lib/supabase/server" itself; opt-in mock so it
// hits a real signed-in demo client under RLS (approvals-pending.test.ts
// precedent). Every other query in this file uses the service-role
// `adminClient()`/raw `sql` below, unaffected by this mock.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import type { Database } from "@/lib/db/types";
import { AGENT_CATALOG, AGENT_SLUGS } from "@/modules/agents/catalog";
import { pendingApprovals } from "@/modules/core/approvals.queries";
import { SendFeeRemindersSchema } from "@/modules/finance/schemas";
import { getSeedScale } from "../../scripts/seed/config.ts";
import { createSeedContext, type SeedContext } from "../../scripts/seed/lib/context.ts";
import { uuidV5 } from "../../scripts/seed/lib/ids.ts";
import { SEEDED_RUN_MARKER, fabricAsOf, pickLifecycleTargets, run as runFabric } from "../../scripts/seed/sections/fabric.ts";
import { buildDemoContext, closeDemoHelper } from "../helpers/demo-context";
import { setActingClient } from "../helpers/server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const repoRoot = path.resolve(import.meta.dirname, "../..");
const fullOnly = getSeedScale() === "full" ? it : it.skip;

function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

function runDemoReset(): void {
  execFileSync("node", ["--env-file-if-exists=.env.local", "scripts/demo-reset.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DEMO_RESET_ALLOWED: "true" },
    stdio: "pipe",
  });
}

// M27-T2 report: pinned against a real run (reset reproduces these exactly —
// severity/confidence/created_at/dedupe_key ordering is deterministic).
const REVIEWING_DEDUPE_KEY = "attendance.student_drop:student:26426df0-65f3-5db1-85eb-7b777a229ac8:2026-W44";
const ACTIONED_DEDUPE_KEY = "staff.workload:staff:3289fc4e-5237-59e0-b21a-0bf851a5fdb7:2358104b-7fb0-58b2-a677-f303f3c01ebb";
const DISMISSED_DEDUPE_KEY = "staff.workload:staff:ff674cf0-f2e1-5c92-9b82-8a2355813cd6:2358104b-7fb0-58b2-a677-f303f3c01ebb";

interface InsightRow {
  id: string;
  domain: string;
  severity: "critical" | "warning" | "watch" | "info";
  confidence: number;
  created_at: string;
  dedupe_key: string;
  approval_required: boolean;
  status: string;
}

let institutionId: string;
let principalUserId: string;
let asOf: string;

async function loadCandidates(): Promise<InsightRow[]> {
  return sql<InsightRow[]>`
    select id, domain, severity, confidence::float8 as confidence, created_at::text as created_at,
           dedupe_key, approval_required, status
    from public.insights
    where institution_id = ${institutionId} and signal <> 'academics.mastery_gap'
  `;
}

function buildCtx(admin: SupabaseClient<Database>): SeedContext {
  const ctx = createSeedContext(() => 0, admin, sql);
  ctx.institutionId = institutionId;
  ctx.userIdByLogin["principal"] = principalUserId;
  return ctx;
}

beforeAll(async () => {
  runDemoReset();
  const [inst] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!inst) throw new Error("Demo institution not found — demo:reset failed.");
  institutionId = inst.id as string;
  const [user] = await sql`select id from auth.users where email = 'principal@demo.coolskool.test'`;
  if (!user) throw new Error("Demo principal login not found.");
  principalUserId = user.id as string;
  asOf = await fabricAsOf(buildCtx(adminClient()));
}, 300_000);

afterAll(async () => {
  await sql.end();
  await closeDemoHelper();
});

const RUN_ATT_DONE_ID = uuidV5("fabric", "agent-run:attendance-done");
const RUN_COM_FAILED_ID = uuidV5("fabric", "agent-run:communication-failed");
const RUN_ADM_REJECTED_ID = uuidV5("fabric", "agent-run:admissions-rejected");
const RUN_FIN_APPROVAL_ID = uuidV5("fabric", "agent-run:finance-reminders");

describe("M27-T2 seed section fabric: insights, lifecycle, interventions", () => {
  fullOnly("fires attendance/staff/operations/admissions candidates, every one dated AS_OF", async () => {
    const rows = await loadCandidates();
    const perDomain: Record<string, number> = {};
    for (const row of rows) perDomain[row.domain] = (perDomain[row.domain] ?? 0) + 1;
    for (const domain of ["attendance", "staff", "operations", "admissions"]) {
      expect(perDomain[domain] ?? 0).toBeGreaterThanOrEqual(1);
    }

    const dateTos = await sql`
      select distinct date_to::text as date_to from public.insights
      where institution_id = ${institutionId} and signal <> 'academics.mastery_gap'
    `;
    expect(dateTos.map((r) => r.date_to as string)).toEqual([asOf]);
  });

  fullOnly("picks the pinned reviewing/actioned/dismissed insights and leaves every other one new", async () => {
    const rows = await loadCandidates();
    const picks = pickLifecycleTargets(rows);
    expect(picks.reviewing?.dedupe_key).toBe(REVIEWING_DEDUPE_KEY);
    expect(picks.actioned?.dedupe_key).toBe(ACTIONED_DEDUPE_KEY);
    expect(picks.dismissed?.dedupe_key).toBe(DISMISSED_DEDUPE_KEY);

    const [reviewing] = await sql`
      select status, reviewer_id from public.insights where institution_id = ${institutionId} and dedupe_key = ${REVIEWING_DEDUPE_KEY}
    `;
    expect(reviewing.status).toBe("reviewing");
    expect(reviewing.reviewer_id).toBe(principalUserId);

    const [actioned] = await sql`
      select id, status from public.insights where institution_id = ${institutionId} and dedupe_key = ${ACTIONED_DEDUPE_KEY}
    `;
    expect(actioned.status).toBe("actioned");
    const actions = await sql`
      select id, status, supersedes_id from public.insight_actions where insight_id = ${actioned.id} order by created_at
    `;
    expect(actions.length).toBe(2);
    expect(actions[0]!.status).toBe("planned");
    expect(actions[1]!.status).toBe("done");
    expect(actions[1]!.supersedes_id).toBe(actions[0]!.id);

    const [dismissed] = await sql`
      select status from public.insights where institution_id = ${institutionId} and dedupe_key = ${DISMISSED_DEDUPE_KEY}
    `;
    expect(dismissed.status).toBe("dismissed");

    const [{ n: notNew }] = await sql`
      select count(*)::int as n from public.insights
      where institution_id = ${institutionId} and signal <> 'academics.mastery_gap' and status <> 'new'
    `;
    expect(notNew).toBe(3);
  });

  fullOnly("audits insight.reviewing/action_recorded/dismissed by the principal, never the note text", async () => {
    const rows = await sql`
      select action, actor_user_id, before, after, metadata from public.audit_events
      where institution_id = ${institutionId} and entity_type = 'insight'
      order by created_at
    `;
    const byAction = new Map<string, (typeof rows)[number][]>();
    for (const row of rows) {
      const list = byAction.get(row.action as string) ?? [];
      list.push(row);
      byAction.set(row.action as string, list);
    }
    expect(byAction.get("insight.reviewing")?.length).toBe(1);
    expect(byAction.get("insight.action_recorded")?.length).toBe(2);
    expect(byAction.get("insight.dismissed")?.length).toBe(1);

    for (const row of rows) {
      expect(row.actor_user_id).toBe(principalUserId);
      const blob = JSON.stringify([row.before, row.after, row.metadata]);
      expect(blob).not.toContain("Known cause");
      expect(blob).not.toContain("Review the evidence");
    }
  });

  // KNOWN DEFECT (M27-T2 report): mastery/detector.ts's planAuthor() requires
  // an active 'owner' membership, which the demo tenant's documented roster
  // (05 §8.1) never creates — runMasteryGapDetector always throws here, so
  // no mastery-gap insight and no intervention plan exists yet.
  // PLAN-VI-A-ACTIVE's precondition ("No plan -> skip and report") already
  // covers this: fabric.ts logs and skips rather than failing the seed.
  // Flip this assertion once a fix widens planAuthor's role filter.
  fullOnly("PLAN-VI-A-ACTIVE is skipped (known defect: demo tenant has no active owner)", async () => {
    const [{ n }] = await sql`
      select count(*)::int as n from public.insight_actions
      where institution_id = ${institutionId} and kind = 'intervention'
    `;
    expect(n).toBe(0);
  });

  it("creates no jobs row for insights.detect or mastery.compute", async () => {
    const rows = await sql`
      select id from public.jobs where institution_id = ${institutionId} and type in ('insights.detect', 'mastery.compute')
    `;
    expect(rows.length).toBe(0);
  });

  it("re-running run(ctx) leaves insight/action/plan counts, statuses, jobs and notifications unchanged", async () => {
    const before = {
      insights: await sql`select count(*)::int as n from public.insights where institution_id = ${institutionId}`,
      actions: await sql`select count(*)::int as n from public.insight_actions where institution_id = ${institutionId}`,
      statuses: await loadCandidates(),
      jobs: await sql`select count(*)::int as n from public.jobs where institution_id = ${institutionId}`,
      notifications: await sql`select count(*)::int as n from public.notifications where institution_id = ${institutionId}`,
    };

    await runFabric(buildCtx(adminClient()));

    const afterInsights = await sql`select count(*)::int as n from public.insights where institution_id = ${institutionId}`;
    const afterActions = await sql`select count(*)::int as n from public.insight_actions where institution_id = ${institutionId}`;
    const afterStatuses = await loadCandidates();
    const afterJobs = await sql`select count(*)::int as n from public.jobs where institution_id = ${institutionId}`;
    const afterNotifications = await sql`select count(*)::int as n from public.notifications where institution_id = ${institutionId}`;

    expect(afterInsights[0]!.n).toBe(before.insights[0]!.n);
    expect(afterActions[0]!.n).toBe(before.actions[0]!.n);
    expect(afterJobs[0]!.n).toBe(before.jobs[0]!.n);
    expect(afterNotifications[0]!.n).toBe(before.notifications[0]!.n);
    expect(afterStatuses.map((r) => [r.dedupe_key, r.status]).sort()).toEqual(
      before.statuses.map((r) => [r.dedupe_key, r.status]).sort(),
    );
  });
});

describe("M27-T3 seed section fabric: forecasts", () => {
  fullOnly("attendance:school and the VI-A section series each get 3 horizons at AS_OF, tied to a backtest of the same series+model, and there is no fees:term row", async () => {
    const forecasts = await sql`
      select id, series_key, model, horizon, as_of::text as as_of, backtest_id
      from public.forecasts where institution_id = ${institutionId}
    `;
    expect(forecasts.length).toBeGreaterThan(0);
    expect(forecasts.every((f) => f.as_of === asOf)).toBe(true);
    expect(forecasts.some((f) => f.series_key === "fees:term")).toBe(false);

    const school = forecasts.filter((f) => f.series_key === "attendance:school");
    expect(school.map((f) => f.horizon as number).sort()).toEqual([1, 2, 3]);

    const [viASection] = await sql`
      select cs.id from public.class_sections cs
      join public.grades g on g.id = cs.grade_id
      where cs.institution_id = ${institutionId} and g.code = 'VI' and cs.name = 'A'
    `;
    const viASeriesKey = `attendance:section:${viASection!.id as string}`;
    const viARows = forecasts.filter((f) => f.series_key === viASeriesKey);
    expect(viARows.map((f) => f.horizon as number).sort()).toEqual([1, 2, 3]);

    for (const f of forecasts) {
      const [bt] = await sql`select series_key, model from public.forecast_backtests where id = ${f.backtest_id}`;
      expect(bt!.series_key).toBe(f.series_key);
      expect(bt!.model).toBe(f.model);
    }
  });

  it("re-running run(ctx) adds no forecast or backtest row", async () => {
    const before = {
      forecasts: await sql`select count(*)::int as n from public.forecasts where institution_id = ${institutionId}`,
      backtests: await sql`select count(*)::int as n from public.forecast_backtests where institution_id = ${institutionId}`,
    };

    await runFabric(buildCtx(adminClient()));

    const afterForecasts = await sql`select count(*)::int as n from public.forecasts where institution_id = ${institutionId}`;
    const afterBacktests = await sql`select count(*)::int as n from public.forecast_backtests where institution_id = ${institutionId}`;
    expect(afterForecasts[0]!.n).toBe(before.forecasts[0]!.n);
    expect(afterBacktests[0]!.n).toBe(before.backtests[0]!.n);
  });
});

describe("M27-T3 seed section fabric: agents", () => {
  it("has exactly the 6 catalog definitions, all enabled", async () => {
    const defs = await sql`select slug, is_enabled from public.agent_definitions where institution_id = ${institutionId}`;
    expect(defs.map((d) => d.slug as string).sort()).toEqual([...AGENT_SLUGS].sort());
    expect(defs.every((d) => d.is_enabled === true)).toBe(true);
  });

  it("seeds RUN-ATT-DONE/RUN-COM-FAILED/RUN-ADM-REJECTED/RUN-FIN-APPROVAL with the table's ids, statuses and risk_class, an honest log/summary, and no 'Called' entry", async () => {
    const runs = await sql`
      select id, status, risk_class, summary, log, proposals, decided_by, finished_at
      from public.agent_runs where institution_id = ${institutionId}
    `;
    expect(runs.length).toBe(4);
    const byId = new Map(runs.map((r) => [r.id as string, r]));

    const expected: Record<string, { status: string; risk_class: string }> = {
      [RUN_ATT_DONE_ID]: { status: "done", risk_class: "read_only" },
      [RUN_COM_FAILED_ID]: { status: "failed", risk_class: "read_only" },
      [RUN_ADM_REJECTED_ID]: { status: "rejected", risk_class: "user_confirmed" },
      [RUN_FIN_APPROVAL_ID]: { status: "awaiting_approval", risk_class: "human_approved" },
    };
    for (const [id, exp] of Object.entries(expected)) {
      const row = byId.get(id);
      expect(row, `missing agent_runs row ${id}`).toBeTruthy();
      expect(row!.status).toBe(exp.status);
      expect(row!.risk_class).toBe(exp.risk_class);
    }

    for (const row of runs) {
      expect(row.summary).toBe("Seeded demo run: no model was called.");
      const log = row.log as { text: string }[];
      expect(log[0]!.text).toBe(SEEDED_RUN_MARKER);
      expect(log.some((entry) => entry.text.startsWith("Called"))).toBe(false);
    }

    const finRun = byId.get(RUN_FIN_APPROVAL_ID)!;
    const finProposal = (finRun.proposals as { action: string; input: unknown }[])[0]!;
    expect(finProposal.action).toBe("finance.reminders.send");
    expect(Object.keys(AGENT_CATALOG.finance.actions)).toContain(finProposal.action);
    expect(SendFeeRemindersSchema.safeParse(finProposal.input).success).toBe(true);

    const admRun = byId.get(RUN_ADM_REJECTED_ID)!;
    expect(admRun.decided_by).toBe(principalUserId);
  });

  it("pendingApprovals surfaces RUN-FIN-APPROVAL to the principal (agent.approve) but not to the admin", async () => {
    const { ctx: principalCtx, client: principalClient } = await buildDemoContext("principal", "principal");
    setActingClient(principalClient);
    let principalRows: Awaited<ReturnType<typeof pendingApprovals>>;
    try {
      principalRows = await pendingApprovals(principalCtx);
    } finally {
      setActingClient(null);
    }
    expect(principalRows.some((r) => r.kind === "agent_run" && r.id === RUN_FIN_APPROVAL_ID)).toBe(true);

    const { ctx: adminCtx, client: adminClient2 } = await buildDemoContext("admin", "admin");
    setActingClient(adminClient2);
    let adminRows: Awaited<ReturnType<typeof pendingApprovals>>;
    try {
      adminRows = await pendingApprovals(adminCtx);
    } finally {
      setActingClient(null);
    }
    expect(adminRows.some((r) => r.id === RUN_FIN_APPROVAL_ID)).toBe(false);
  });

  it("re-running run(ctx) adds no agent_definition or agent_run row", async () => {
    const before = {
      defs: await sql`select count(*)::int as n from public.agent_definitions where institution_id = ${institutionId}`,
      runs: await sql`select count(*)::int as n from public.agent_runs where institution_id = ${institutionId}`,
    };

    await runFabric(buildCtx(adminClient()));

    const afterDefs = await sql`select count(*)::int as n from public.agent_definitions where institution_id = ${institutionId}`;
    const afterRuns = await sql`select count(*)::int as n from public.agent_runs where institution_id = ${institutionId}`;
    expect(afterDefs[0]!.n).toBe(before.defs[0]!.n);
    expect(afterRuns[0]!.n).toBe(before.runs[0]!.n);
  });
});

/** Rulings "Determinism, idempotency, reset" — business-field fingerprint, excludes gen_random_uuid()-sourced ids. */
async function fabricFingerprint(): Promise<unknown> {
  const insights = await sql`
    select signal, dedupe_key, severity, confidence::float8 as confidence, status, evidence
    from public.insights where institution_id = ${institutionId} order by dedupe_key
  `;
  const actions = await sql`
    select i.dedupe_key as insight_dedupe_key, a.action, a.status
    from public.insight_actions a join public.insights i on i.id = a.insight_id
    where a.institution_id = ${institutionId}
    order by i.dedupe_key, a.created_at
  `;
  const forecasts = await sql`
    select series_key, model, horizon, period_start::text as period_start, point, lower, upper
    from public.forecasts where institution_id = ${institutionId} order by series_key, horizon
  `;
  const backtests = await sql`
    select series_key, model, mape from public.forecast_backtests
    where institution_id = ${institutionId} order by series_key, model
  `;
  const agentDefs = await sql`select slug from public.agent_definitions where institution_id = ${institutionId} order by slug`;
  const agentRuns = await sql`
    select id, status, risk_class, proposals from public.agent_runs
    where institution_id = ${institutionId} order by id
  `;
  return { insights, actions, forecasts, backtests, agentDefs, agentRuns };
}

describe("M27-T3 seed section fabric: reset determinism", () => {
  it(
    "demo:reset reproduces the same fingerprint and leaves fabric rows present",
    async () => {
      const before = await fabricFingerprint();

      runDemoReset();

      const after = await fabricFingerprint();
      expect(after).toEqual(before);

      const [{ n: defCount }] = await sql`select count(*)::int as n from public.agent_definitions where institution_id = ${institutionId}`;
      const [{ n: runCount }] = await sql`select count(*)::int as n from public.agent_runs where institution_id = ${institutionId}`;
      const [{ n: forecastCount }] = await sql`select count(*)::int as n from public.forecasts where institution_id = ${institutionId}`;
      expect(defCount).toBe(6);
      expect(runCount).toBe(4);
      expect(forecastCount).toBeGreaterThan(0);
    },
    300_000,
  );
});
