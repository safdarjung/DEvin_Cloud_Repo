import type postgres from "postgres";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { SEVERITY_RANK } from "../../../src/modules/insights/signals.ts";
import { insightsDetect } from "../../../src/modules/jobs/handlers/insights.detect.ts";
import { forecastRun } from "../../../src/modules/jobs/handlers/forecast.run.ts";
import type { JobRow } from "../../../src/modules/jobs/types.ts";
import { runMasteryGapDetector } from "../../../src/modules/mastery/detector.ts";
import { AGENT_CATALOG_VERSION, AGENT_SLUGS, type AgentLogEntry, type AgentProposal, type AgentSlug } from "../../../src/modules/agents/catalog.ts";

// M27-T2/T3 — seed section `fabric` (M27-tasks.md rulings "Seed section
// `fabric`"). Runs last, after every other section. Part 1 (insights,
// lifecycle, interventions) is above; part 2 (forecasts, agents) is below.
// Every row comes from the real deterministic engine, called in-process
// with ctx.admin/ctx.sql — never a literal insert, except the 4 agent runs
// (rulings "Agents": no engine can produce a run without a model). Relative
// `.ts` imports only: `pnpm seed`/`pnpm demo:reset` load this file as plain
// node (BRIEF-COMMON). `src/modules/agents/{executor,service-role}.ts`
// import the `server-only` marker package, which throws under plain node
// (confirmed against node_modules/server-only/index.js) — never import
// those two files here; `catalog.ts` has no imports for exactly this
// reason and is the only agents file this section touches.

// M27-T3 — honesty marker (rulings "Honesty"): every seeded agent run's
// first log line, so a reader never mistakes it for a real model call.
export const SEEDED_RUN_MARKER = "Seeded demo run (no model call)";
const SEEDED_RUN_SUMMARY = "Seeded demo run: no model was called.";

// M19's 11 signals (0092); excludes M20's `academics.mastery_gap` (0093 pt4).
const MASTERY_GAP_SIGNAL = "academics.mastery_gap";
const ACTIONED_DOMAINS = new Set(["finance", "operations", "staff", "admissions"]);

interface LifecycleCandidate {
  id: string;
  domain: string;
  severity: keyof typeof SEVERITY_RANK;
  confidence: number;
  created_at: string;
  dedupe_key: string;
  approval_required: boolean;
  status: string;
}

interface LifecyclePicks {
  reviewing: LifecycleCandidate | null;
  actioned: LifecycleCandidate | null;
  dismissed: LifecycleCandidate | null;
}

/** Rulings "Lifecycle picks": severity rank desc, confidence desc, created_at asc, dedupe_key asc. Pure. */
function compareCandidates(a: LifecycleCandidate, b: LifecycleCandidate): number {
  if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.dedupe_key < b.dedupe_key ? -1 : a.dedupe_key > b.dedupe_key ? 1 : 0;
}

/** INS-REVIEWING / INS-ACTIONED / INS-DISMISSED targets, with their fallbacks. Pure. */
export function pickLifecycleTargets(rows: LifecycleCandidate[]): LifecyclePicks {
  const sorted = [...rows].sort(compareCandidates);
  const picked = new Set<string>();

  const reviewing =
    sorted.find((r) => r.domain === "attendance" && !picked.has(r.id)) ?? sorted.find((r) => !picked.has(r.id)) ?? null;
  if (reviewing) picked.add(reviewing.id);

  const actioned =
    sorted.find((r) => ACTIONED_DOMAINS.has(r.domain) && !picked.has(r.id)) ?? sorted.find((r) => !picked.has(r.id)) ?? null;
  if (actioned) picked.add(actioned.id);

  let dismissed: LifecycleCandidate | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const row = sorted[i]!;
    if (!row.approval_required && !picked.has(row.id)) {
      dismissed = row;
      break;
    }
  }
  if (dismissed) picked.add(dismissed.id);

  return { reviewing, actioned, dismissed };
}

/** AS_OF = max(date) of the demo tenant's daily (period_id null), submitted attendance_sessions. */
export async function fabricAsOf(ctx: SeedContext): Promise<string> {
  const { data, error } = await ctx.admin
    .from("attendance_sessions")
    .select("date")
    .eq("institution_id", ctx.institutionId)
    .is("period_id", null)
    .eq("status", "submitted")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`fabric: fabricAsOf query failed: ${error.message}`);
  if (!data) throw new Error("fabric: no submitted daily attendance_sessions found for AS_OF");
  return data.date;
}

function buildInsightsDetectJob(ctx: SeedContext, asOf: string): JobRow {
  const now = new Date().toISOString();
  return {
    id: uuidV5("fabric", "job:insights.detect"),
    institution_id: ctx.institutionId,
    type: "insights.detect",
    payload: { as_of: asOf },
    idempotency_key: `fabric:insights.detect:${ctx.institutionId}`,
    status: "running",
    attempts: 1,
    max_attempts: 5,
    run_after: now,
    locked_at: now,
    locked_by: "seed",
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

/** Runs the real decide_insight/record_insight_action RPCs as the demo principal (exams.ts publish precedent). */
async function asPrincipal<T>(ctx: SeedContext, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const principalUserId = ctx.userIdByLogin["principal"]!;
  return (await ctx.sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: principalUserId, role: "authenticated" })}, true)`;
    return fn(tx);
  })) as T;
}

async function runLifecyclePicks(ctx: SeedContext): Promise<void> {
  const { data, error } = await ctx.admin
    .from("insights")
    .select("id, domain, severity, confidence, created_at, dedupe_key, approval_required, status")
    .eq("institution_id", ctx.institutionId)
    .neq("signal", MASTERY_GAP_SIGNAL);
  if (error) throw new Error(`fabric: loading lifecycle candidates failed: ${error.message}`);

  const candidates: LifecycleCandidate[] = data.map((row) => ({
    id: row.id,
    domain: row.domain,
    severity: row.severity as keyof typeof SEVERITY_RANK,
    confidence: Number(row.confidence),
    created_at: row.created_at,
    dedupe_key: row.dedupe_key,
    approval_required: row.approval_required,
    status: row.status,
  }));

  if (candidates.length < 3) {
    console.log(`  fabric: only ${candidates.length} lifecycle candidate(s) — some picks will be skipped.`);
  }

  const { reviewing, actioned, dismissed } = pickLifecycleTargets(candidates);

  if (reviewing && reviewing.status === "new") {
    await asPrincipal(ctx, (tx) => tx`select public.decide_insight(${reviewing.id}::uuid, 'review')`);
  } else if (!reviewing) {
    console.log("  fabric: no candidate available for INS-REVIEWING — skipped.");
  }

  if (actioned && actioned.status === "new") {
    // CTE materializes the function call exactly once before `.*` expands
    // it — `select (f()).*` directly in the target list re-invokes a
    // volatile `f()` once per expanded column (insight_actions has 22;
    // confirmed against the real demo tenant during this packet).
    const [plannedRow] = await asPrincipal(
      ctx,
      (tx) => tx`
        with ins as (
          select public.record_insight_action(
            p_insight_id := ${actioned.id}::uuid,
            p_action := 'Review the evidence with the responsible staff',
            p_owner := ${"Principal's office"},
            p_rationale := 'Raised by the insights engine for follow-up.',
            p_expected_outcome := 'Cause identified and a fix agreed.',
            p_status := 'planned'
          ) as row
        )
        select (row).* from ins
      `,
    );
    const plannedId = plannedRow!.id as string;
    await asPrincipal(
      ctx,
      (tx) => tx`
        select public.record_insight_action(
          p_insight_id := ${actioned.id}::uuid,
          p_action := 'Review the evidence with the responsible staff',
          p_owner := ${"Principal's office"},
          p_rationale := 'Raised by the insights engine for follow-up.',
          p_expected_outcome := 'Cause identified and a fix agreed.',
          p_status := 'done',
          p_supersedes_id := ${plannedId}::uuid
        )
      `,
    );
  } else if (!actioned) {
    console.log("  fabric: no candidate available for INS-ACTIONED — skipped.");
  }

  if (dismissed && dismissed.status === "new") {
    await asPrincipal(
      ctx,
      (tx) => tx`select public.decide_insight(${dismissed.id}::uuid, 'dismiss', 'Known cause; no action needed this term.')`,
    );
  } else if (!dismissed) {
    console.log("  fabric: no candidate available for INS-DISMISSED — skipped.");
  }

  console.log(
    `  fabric: lifecycle picks — reviewing=${reviewing?.dedupe_key ?? "none"}, actioned=${actioned?.dedupe_key ?? "none"}, dismissed=${dismissed?.dedupe_key ?? "none"}`,
  );
}

interface InterventionCandidate {
  id: string;
  student_id: string;
  grade_code: string;
  section_name: string;
  roll_no: number | null;
}

/** PLAN-VI-A-ACTIVE: first proposed plan of a VI-A student by roll_no (fallback: section label, then student_id). */
async function pickInterventionPlan(ctx: SeedContext): Promise<InterventionCandidate | null> {
  const rows = await ctx.sql<InterventionCandidate[]>`
    select ia.id, ia.student_id, g.code as grade_code, cs.name as section_name, en.roll_no
    from public.insight_actions ia
    join public.enrolments en on en.student_id = ia.student_id and en.status = 'active'
    join public.class_sections cs on cs.id = en.class_section_id
    join public.grades g on g.id = cs.grade_id
    where ia.institution_id = ${ctx.institutionId}
      and ia.kind = 'intervention'
      and ia.intervention_status = 'proposed'
  `;
  if (rows.length === 0) return null;

  const viA = rows.filter((r) => r.grade_code === "VI" && r.section_name === "A" && r.roll_no !== null);
  if (viA.length > 0) {
    return [...viA].sort((a, b) => a.roll_no! - b.roll_no!)[0]!;
  }

  return [...rows].sort((a, b) => {
    const labelA = `${a.grade_code}-${a.section_name}`;
    const labelB = `${b.grade_code}-${b.section_name}`;
    if (labelA !== labelB) return labelA < labelB ? -1 : 1;
    return a.student_id < b.student_id ? -1 : a.student_id > b.student_id ? 1 : 0;
  })[0]!;
}

async function activateInterventionPlan(ctx: SeedContext): Promise<void> {
  const { count, error: countError } = await ctx.admin
    .from("insight_actions")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", ctx.institutionId)
    .eq("kind", "intervention")
    .eq("intervention_status", "active");
  if (countError) throw new Error(`fabric: checking active intervention failed: ${countError.message}`);
  if (count && count > 0) return; // idempotent rerun guard — already activated

  const plan = await pickInterventionPlan(ctx);
  if (!plan) {
    console.log("  fabric: no proposed intervention plan found — PLAN-VI-A-ACTIVE skipped.");
    return;
  }

  const { error } = await ctx.admin.from("insight_actions").update({ intervention_status: "active" }).eq("id", plan.id);
  if (error) throw new Error(`fabric: activating intervention plan failed: ${error.message}`);
  console.log(`  fabric: PLAN-VI-A-ACTIVE = insight_actions ${plan.id} (student ${plan.student_id})`);
}

function buildForecastRunJob(ctx: SeedContext, asOf: string): JobRow {
  const now = new Date().toISOString();
  return {
    id: uuidV5("fabric", "job:forecast.run"),
    institution_id: ctx.institutionId,
    type: "forecast.run",
    payload: { as_of: asOf },
    idempotency_key: `fabric:forecast.run:${ctx.institutionId}`,
    status: "running",
    attempts: 1,
    max_attempts: 5,
    run_after: now,
    locked_at: now,
    locked_by: "seed",
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

/** Rulings "Forecasts": real forecast.run engine, in-process. Idempotent via its own (institution_id, series_key, …) upserts. */
async function runForecastStep(ctx: SeedContext, asOf: string): Promise<void> {
  const job = buildForecastRunJob(ctx, asOf);
  await forecastRun(job, { admin: ctx.admin });
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function minutesAfterIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

/** Rulings "Agents": the 6 catalog slugs, `on conflict (institution_id, slug) do nothing`. Never `ensureAgentDefinitions`/`executor.ts` — both import `server-only`. */
async function seedAgentDefinitions(ctx: SeedContext): Promise<Record<AgentSlug, string>> {
  const { error } = await ctx.admin
    .from("agent_definitions")
    .upsert(
      AGENT_SLUGS.map((slug) => ({ institution_id: ctx.institutionId, slug, is_enabled: true })),
      { onConflict: "institution_id,slug", ignoreDuplicates: true },
    );
  if (error) throw new Error(`fabric: seeding agent_definitions failed: ${error.message}`);

  const { data, error: selectError } = await ctx.admin
    .from("agent_definitions")
    .select("id, slug")
    .eq("institution_id", ctx.institutionId);
  if (selectError) throw new Error(`fabric: loading agent_definitions failed: ${selectError.message}`);

  const idBySlug = {} as Record<AgentSlug, string>;
  for (const row of data ?? []) idBySlug[row.slug as AgentSlug] = row.id as string;
  return idBySlug;
}

/** Oldest `new` enquiry, tie-broken by id (rulings "Agents" RUN-ADM-REJECTED). The demo contract (05 §8.1) always seeds 12 `new` enquiries. */
async function pickOldestNewEnquiry(ctx: SeedContext): Promise<{ id: string } | null> {
  const { data, error } = await ctx.admin
    .from("enquiries")
    .select("id")
    .eq("institution_id", ctx.institutionId)
    .eq("status", "new")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`fabric: loading oldest new enquiry failed: ${error.message}`);
  return data ? { id: data.id as string } : null;
}

function logEntry(at: string, text: string, level: AgentLogEntry["level"] = "info"): AgentLogEntry {
  return { at, level, text };
}

/** Rulings "Agents": 4 literal runs — no engine can produce these without a model. `on conflict (id) do nothing`, so a rerun adds nothing. */
async function seedAgentRuns(ctx: SeedContext): Promise<void> {
  const idBySlug = await seedAgentDefinitions(ctx);
  const principalUserId = ctx.userIdByLogin["principal"]!;

  const attDoneCreatedAt = hoursAgoIso(50);
  const comFailedCreatedAt = hoursAgoIso(26);
  const admRejectedCreatedAt = hoursAgoIso(6);
  const finApprovalCreatedAt = hoursAgoIso(2);

  const oldestEnquiry = await pickOldestNewEnquiry(ctx);
  if (!oldestEnquiry) throw new Error("fabric: no 'new' enquiry found for RUN-ADM-REJECTED (05 §8.1 demo contract).");

  const attDoneFinishedAt = minutesAfterIso(attDoneCreatedAt, 1);
  const comFailedFinishedAt = minutesAfterIso(comFailedCreatedAt, 1);
  const admRejectedFinishedAt = minutesAfterIso(admRejectedCreatedAt, 1);

  const admProposal: AgentProposal = {
    action: "admissions.enquiry.note",
    input: { enquiryId: oldestEnquiry.id, text: "Reaching out again before we lose touch — any update on next steps?" },
    risk_class: "user_confirmed",
    status: "skipped",
    error_code: null,
  };
  const finProposal: AgentProposal = {
    action: "finance.reminders.send",
    input: { termId: ctx.termIds.term2 },
    risk_class: "human_approved",
    status: "proposed",
    error_code: null,
  };

  const runs = [
    {
      id: uuidV5("fabric", "agent-run:attendance-done"),
      institution_id: ctx.institutionId,
      agent_id: idBySlug.attendance,
      task: "Which sections are below the attendance threshold today?",
      requested_by: principalUserId,
      risk_class: "read_only",
      status: "done",
      catalog_version: AGENT_CATALOG_VERSION,
      started_at: attDoneCreatedAt,
      finished_at: attDoneFinishedAt,
      summary: SEEDED_RUN_SUMMARY,
      log: [logEntry(attDoneCreatedAt, SEEDED_RUN_MARKER), logEntry(attDoneFinishedAt, "Finished: done")],
      proposals: [],
      decided_by: null,
      decided_at: null,
      decision_note: null,
      created_at: attDoneCreatedAt,
    },
    {
      id: uuidV5("fabric", "agent-run:communication-failed"),
      institution_id: ctx.institutionId,
      agent_id: idBySlug.communication,
      task: "Draft a reminder about next week's events.",
      requested_by: principalUserId,
      risk_class: "read_only",
      status: "failed",
      catalog_version: AGENT_CATALOG_VERSION,
      started_at: comFailedCreatedAt,
      finished_at: comFailedFinishedAt,
      summary: SEEDED_RUN_SUMMARY,
      log: [logEntry(comFailedCreatedAt, SEEDED_RUN_MARKER), logEntry(comFailedFinishedAt, "Finished: failed")],
      proposals: [],
      decided_by: null,
      decided_at: null,
      decision_note: null,
      created_at: comFailedCreatedAt,
    },
    {
      id: uuidV5("fabric", "agent-run:admissions-rejected"),
      institution_id: ctx.institutionId,
      agent_id: idBySlug.admissions,
      task: "Add a follow-up note to the oldest new enquiry.",
      requested_by: principalUserId,
      risk_class: "user_confirmed",
      status: "rejected",
      catalog_version: AGENT_CATALOG_VERSION,
      started_at: admRejectedCreatedAt,
      finished_at: admRejectedFinishedAt,
      summary: SEEDED_RUN_SUMMARY,
      log: [
        logEntry(admRejectedCreatedAt, SEEDED_RUN_MARKER),
        logEntry(admRejectedCreatedAt, "Proposed admissions.enquiry.note (user_confirmed)"),
        logEntry(admRejectedFinishedAt, "Rejected by principal", "warn"),
        logEntry(admRejectedFinishedAt, "Finished: rejected"),
      ],
      proposals: [admProposal],
      decided_by: principalUserId,
      decided_at: admRejectedFinishedAt,
      decision_note: "Not needed this week.",
      created_at: admRejectedCreatedAt,
    },
    {
      id: uuidV5("fabric", "agent-run:finance-reminders"),
      institution_id: ctx.institutionId,
      agent_id: idBySlug.finance,
      task: "Send fee reminders to families with overdue invoices.",
      requested_by: principalUserId,
      risk_class: "human_approved",
      status: "awaiting_approval",
      catalog_version: AGENT_CATALOG_VERSION,
      started_at: finApprovalCreatedAt,
      finished_at: null,
      summary: SEEDED_RUN_SUMMARY,
      log: [
        logEntry(finApprovalCreatedAt, SEEDED_RUN_MARKER),
        logEntry(finApprovalCreatedAt, "Proposed finance.reminders.send (human_approved)"),
      ],
      proposals: [finProposal],
      decided_by: null,
      decided_at: null,
      decision_note: null,
      created_at: finApprovalCreatedAt,
    },
  ];

  const { error } = await ctx.admin.from("agent_runs").upsert(runs as never, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(`fabric: seeding agent_runs failed: ${error.message}`);
}

export async function run(ctx: SeedContext): Promise<void> {
  // Tables loaded moments ago may have no planner stats yet; the detector/forecast RPCs below run
  // under PostgREST's 8s statement_timeout, and a stats-less plan can blow past it.
  await ctx.sql`analyze`;
  const asOf = await fabricAsOf(ctx);

  const job = buildInsightsDetectJob(ctx, asOf);
  await insightsDetect(job, { admin: ctx.admin });

  await runMasteryGapDetector(ctx.admin, ctx.institutionId);

  await runLifecyclePicks(ctx);
  await activateInterventionPlan(ctx);
  await runForecastStep(ctx, asOf);
  await seedAgentRuns(ctx);
}
