// M27-T7 — perf budget for the 45 tenant tables M12-M25/X01-X08 added (06
// rulings "Perf (T7)"). Reads the already-seeded demo tenant — run
// `pnpm db:reset` first (CLAUDE.md "Run only your packet's targeted tests").
// Big = >=10,000 demo-tenant rows. `NEW_TABLES` is the full list; the first
// test asserts every big table among them has a `PERF_MATRIX` entry, so a
// future big table can't slip through unmeasured. The second test times
// each entry's probes: 1 warm-up + 3 timed calls, median must be <1500ms
// (the M16 budget — never raise it; a miss is a finding, stop and report).
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createClient } from "@supabase/supabase-js";
import { POST } from "@/app/api/v1/query/[name]/route";

const WARMUPS = 1;
const TIMED_CALLS = 3;
const BUDGET_MS = 1500;
const BIG_ROW_THRESHOLD = 10_000;
const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";

// 06 rulings "Tables in scope" — the 45 tenant tables M12-M25 and X01-X08 added.
export const NEW_TABLES = [
  "payment_reversals",
  "fee_reminders",
  "online_payment_intents",
  "assets",
  "maintenance_requests",
  "transport_vehicles",
  "transport_routes",
  "transport_stops",
  "transport_assignments",
  "academic_calendar_events",
  "student_lifecycle_events",
  "scheduled_reports",
  "insights",
  "insight_actions",
  "briefings",
  "mastery_snapshots",
  "forecasts",
  "forecast_backtests",
  "agent_definitions",
  "agent_runs",
  "workflows",
  "workflow_runs",
  "student_leave_requests",
  "diary_entries",
  "diary_acknowledgements",
  "certificates",
  "library_books",
  "library_copies",
  "library_loans",
  "late_fee_rules",
  "invoice_instalments",
  "late_fee_charges",
  "exam_seating_plans",
  "exam_seats",
  "visitor_entries",
  "pickup_persons",
  "gate_passes",
  "ptm_events",
  "ptm_event_sections",
  "ptm_slots",
  "ptm_bookings",
  "surveys",
  "survey_audiences",
  "survey_respondents",
  "survey_responses",
] as const;

type Login = "principal" | "teacher.vi-a" | "student.one" | "guardian.one";

/** A plain RLS count(*) through the policy (the 0020 per-row-SECURITY-DEFINER failure mode). */
interface CountProbe {
  kind: "count";
  login: Login;
}

/** A registered query over the in-process route (M16-T14 pattern), bearer-token auth. */
interface QueryProbe {
  kind: "query";
  name: string;
  login: Login;
  /** Resolved to real input at test time — ids depend on the seeded tenant. */
  input: "none" | "vi-a-section" | "self-student" | "aarav";
}

type Probe = CountProbe | QueryProbe;

// Only `mastery_snapshots` measures big today (~44k rows); re-running the
// first test below is what proves that, not this literal.
export const PERF_MATRIX: Record<string, Probe[]> = {
  mastery_snapshots: [
    { kind: "count", login: "principal" },
    { kind: "count", login: "teacher.vi-a" },
    { kind: "count", login: "student.one" },
    { kind: "count", login: "guardian.one" },
    { kind: "query", name: "mastery.heatmapBySection", login: "principal", input: "none" },
    { kind: "query", name: "mastery.heatmapBySection", login: "teacher.vi-a", input: "none" },
    { kind: "query", name: "mastery.studentSuccessRows", login: "teacher.vi-a", input: "vi-a-section" },
    { kind: "query", name: "mastery.gapsForStudent", login: "student.one", input: "self-student" },
    { kind: "query", name: "mastery.gapsForStudent", login: "guardian.one", input: "aarav" },
  ],
};

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let institutionId: string;
let institutionSlug: string;
let viASectionId: string;
let studentOneId: string;
let aaravId: string;
const rowCounts: Record<string, number> = {};
const tokens = new Map<string, string>();

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
}

async function signInDemo(login: Login) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: `${login}@demo.coolskool.test`,
    password: SEED_PASSWORD,
  });
  if (error) throw error;
  return client;
}

async function tokenFor(login: Login): Promise<string> {
  const cached = tokens.get(login);
  if (cached) return cached;
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: `${login}@demo.coolskool.test`,
    password: SEED_PASSWORD,
  });
  if (error || !data.session) throw error ?? new Error(`no session for ${login}`);
  tokens.set(login, data.session.access_token);
  return data.session.access_token;
}

function postRequest(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/v1/query/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ name }) },
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function queryInput(kind: QueryProbe["input"]): Record<string, unknown> {
  switch (kind) {
    case "none":
      return {};
    case "vi-a-section":
      return { classSectionId: viASectionId };
    case "self-student":
      return { studentId: studentOneId };
    case "aarav":
      return { studentId: aaravId };
  }
}

/** 1 warm-up + TIMED_CALLS timed round trips through the table's RLS policy. */
async function timedCount(login: Login, table: string): Promise<number> {
  const client = await signInDemo(login);
  const durations: number[] = [];
  for (let i = 0; i < WARMUPS + TIMED_CALLS; i++) {
    const start = performance.now();
    const { error } = await client.from(table).select("id", { count: "exact", head: true }).eq("institution_id", institutionId);
    const ms = performance.now() - start;
    if (error) throw error;
    if (i >= WARMUPS) durations.push(ms);
  }
  return median(durations);
}

/** 1 warm-up + TIMED_CALLS timed round trips through the registered-query route. */
async function timedQuery(probe: QueryProbe): Promise<number> {
  const token = await tokenFor(probe.login);
  const input = queryInput(probe.input);
  const durations: number[] = [];
  for (let i = 0; i < WARMUPS + TIMED_CALLS; i++) {
    const start = performance.now();
    const res = await postRequest(probe.name, { institution: institutionSlug, input }, { authorization: `Bearer ${token}` });
    const ms = performance.now() - start;
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    if (i >= WARMUPS) durations.push(ms);
  }
  return median(durations);
}

beforeAll(async () => {
  const [inst] = await sql`select id, slug from public.institutions where slug = 'st-josephs-demo'`;
  if (!inst) throw new Error("Demo institution not found — run `pnpm db:reset` first.");
  institutionId = inst.id as string;
  institutionSlug = inst.slug as string;

  const [section] = await sql`
    select cs.id from public.class_sections cs join public.grades g on g.id = cs.grade_id
    where cs.institution_id = ${institutionId} and g.code = 'VI' and cs.name = 'A'
  `;
  viASectionId = section.id as string;

  const [studentOne] = await sql`
    select m.student_id from public.memberships m join auth.users u on u.id = m.user_id
    where m.institution_id = ${institutionId} and u.email = 'student.one@demo.coolskool.test'
  `;
  studentOneId = studentOne.student_id as string;

  const [guardianOne] = await sql`
    select m.guardian_id from public.memberships m join auth.users u on u.id = m.user_id
    where m.institution_id = ${institutionId} and u.email = 'guardian.one@demo.coolskool.test'
  `;
  const [aarav] = await sql`
    select gs.student_id from public.guardian_students gs join public.students s on s.id = gs.student_id
    where gs.institution_id = ${institutionId} and gs.guardian_id = ${guardianOne.guardian_id} and s.first_name = 'Aarav'
  `;
  if (!aarav) throw new Error("guardian.one's child Aarav not found — run `pnpm db:reset` first.");
  aaravId = aarav.student_id as string;

  for (const table of NEW_TABLES) {
    const [row] = await sql`select count(*)::int as n from public.${sql(table)} where institution_id = ${institutionId}`;
    rowCounts[table] = row.n as number;
  }
}, 30_000);

afterAll(async () => {
  console.log("M27-T7 fabric row counts:", rowCounts);
  await sql.end();
});

describe("M27-T7 fabric perf — big new tables on the seeded demo tenant", () => {
  it("every new table with >= 10,000 demo rows has a PERF_MATRIX entry", () => {
    const big = NEW_TABLES.filter((table) => rowCounts[table] >= BIG_ROW_THRESHOLD);
    for (const table of big) {
      expect(Object.keys(PERF_MATRIX)).toContain(table);
    }
  });

  const medians: Record<string, number> = {};

  afterAll(() => {
    console.log("M27-T7 fabric perf medians (ms):", medians);
  });

  for (const [table, probes] of Object.entries(PERF_MATRIX)) {
    for (const probe of probes) {
      const label =
        probe.kind === "count" ? `${table}: count(*) as ${probe.login}` : `${table}: ${probe.name} as ${probe.login}`;

      it(`each probe's median < ${BUDGET_MS} ms — ${label}`, async () => {
        const ms = probe.kind === "count" ? await timedCount(probe.login, table) : await timedQuery(probe);
        medians[label] = ms;
        expect(ms).toBeLessThan(BUDGET_MS);
      }, 20_000);
    }
  }
});
