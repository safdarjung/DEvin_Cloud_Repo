// M16-T14 — perf budget (06 rulings "Perf budget: < 1.5 s per dashboard
// query"). Each matrix row is a real round trip through the exported
// GET/POST of /api/v1/query/[name] with a seeded demo user's bearer token
// (api-query-route.test.ts pattern: next/headers mocked only, @/lib/supabase
// is NOT mocked, so auth, context, module gate, permission and RLS all run).
// 1 warm-up call, then 3 timed calls; asserts 200 + ok, and the median of
// the 3 timed calls is under 1500 ms. Medians are logged for the report.
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
import type { Database } from "@/lib/db/types";
import { POST } from "@/app/api/v1/query/[name]/route";

const WARMUPS = 1;
const TIMED_CALLS = 3;
const BUDGET_MS = 1500;
const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const tokens = new Map<string, string>();
let institutionSlug: string;
let guardianOneFirstChildId: string;

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

async function tokenFor(loginKey: string): Promise<string> {
  const cached = tokens.get(loginKey);
  if (cached) return cached;
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { data, error } = await client.auth.signInWithPassword({
    email: `${loginKey}@demo.coolskool.test`,
    password: SEED_PASSWORD,
  });
  if (error || !data.session) throw error ?? new Error(`no session for ${loginKey}`);
  tokens.set(loginKey, data.session.access_token);
  return data.session.access_token;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** 1 warm-up + TIMED_CALLS timed round trips; asserts 200 + ok on every call. */
async function timedRun(name: string, token: string, input: unknown): Promise<number> {
  const durations: number[] = [];
  for (let i = 0; i < WARMUPS + TIMED_CALLS; i++) {
    const start = performance.now();
    const res = await postRequest(name, { institution: institutionSlug, input }, { authorization: `Bearer ${token}` });
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
  institutionSlug = inst.slug as string;

  const [guardianRow] = await sql`
    select m.guardian_id
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.institution_id = ${inst.id} and u.email = 'guardian.one@demo.coolskool.test'
  `;
  const [childRow] = await sql`
    select student_id from public.guardian_students
    where institution_id = ${inst.id} and guardian_id = ${guardianRow.guardian_id}
    order by student_id limit 1
  `;
  guardianOneFirstChildId = childRow.student_id as string;
}, 30_000);

afterAll(async () => {
  await sql.end();
});

// 06 rulings "Perf budget" matrix.
describe("M16-T14 dashboard perf budget (< 1.5s median, seeded demo tenant)", () => {
  const medians: Record<string, number> = {};

  afterAll(() => {
    console.log("M16-T14 dashboard perf medians (ms):", medians);
  });

  it("principal: dashboard.principal", async () => {
    const token = await tokenFor("principal");
    medians["principal → dashboard.principal"] = await timedRun("dashboard.principal", token, {});
    expect(medians["principal → dashboard.principal"]).toBeLessThan(BUDGET_MS);
  }, 20_000);

  it("principal: core.approvals.pending", async () => {
    const token = await tokenFor("principal");
    medians["principal → core.approvals.pending"] = await timedRun("core.approvals.pending", token, {});
    expect(medians["principal → core.approvals.pending"]).toBeLessThan(BUDGET_MS);
  }, 20_000);

  it("principal: dashboard.attendanceTrend {days:92} (worst case)", async () => {
    const token = await tokenFor("principal");
    medians["principal → dashboard.attendanceTrend{92}"] = await timedRun("dashboard.attendanceTrend", token, { days: 92 });
    expect(medians["principal → dashboard.attendanceTrend{92}"]).toBeLessThan(BUDGET_MS);
  }, 20_000);

  it("admin: dashboard.operations", async () => {
    const token = await tokenFor("admin");
    medians["admin → dashboard.operations"] = await timedRun("dashboard.operations", token, {});
    expect(medians["admin → dashboard.operations"]).toBeLessThan(BUDGET_MS);
  }, 20_000);

  it("accountant: dashboard.finance", async () => {
    const token = await tokenFor("accountant");
    medians["accountant → dashboard.finance"] = await timedRun("dashboard.finance", token, {});
    expect(medians["accountant → dashboard.finance"]).toBeLessThan(BUDGET_MS);
  }, 20_000);

  it("admissions: dashboard.admissions", async () => {
    const token = await tokenFor("admissions");
    medians["admissions → dashboard.admissions"] = await timedRun("dashboard.admissions", token, {});
    expect(medians["admissions → dashboard.admissions"]).toBeLessThan(BUDGET_MS);
  }, 20_000);

  it("teacher.vi-a: dashboard.teacher", async () => {
    const token = await tokenFor("teacher.vi-a");
    medians["teacher.vi-a → dashboard.teacher"] = await timedRun("dashboard.teacher", token, {});
    expect(medians["teacher.vi-a → dashboard.teacher"]).toBeLessThan(BUDGET_MS);
  }, 20_000);

  it("guardian.one: dashboard.parent {first child}", async () => {
    const token = await tokenFor("guardian.one");
    medians["guardian.one → dashboard.parent"] = await timedRun("dashboard.parent", token, {
      studentId: guardianOneFirstChildId,
    });
    expect(medians["guardian.one → dashboard.parent"]).toBeLessThan(BUDGET_MS);
  }, 20_000);

  it("student.one: dashboard.student", async () => {
    const token = await tokenFor("student.one");
    medians["student.one → dashboard.student"] = await timedRun("dashboard.student", token, {});
    expect(medians["student.one → dashboard.student"]).toBeLessThan(BUDGET_MS);
  }, 20_000);
});
