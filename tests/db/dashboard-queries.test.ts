import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (same pattern as tests/db/attendance-actions.test.ts) so the
// plain query functions under test run their own `createClient()` calls
// against a real signed-in demo-tenant client instead of Next's cookie jar.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { AppError } from "@/lib/actions/result";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import type { Database } from "@/lib/db/types";
import { attendanceTodaySummary, sectionsBelowThreshold } from "@/modules/attendance/queries";
import { getAdmissionsFunnelCounts } from "@/modules/admissions/queries";
import { getDashboardData } from "@/modules/core/dashboard.queries";
import { examGradeDistribution } from "@/modules/exams/queries";
import { termCollectionSummary } from "@/modules/finance/queries";
import { setActingClient } from "../helpers/server-client-mock";

// T-039 — reads the already-seeded `st-josephs-demo` tenant (CLAUDE.md: "run
// only your packet's targeted tests"; seeding ~181k attendance records is
// too slow to redo per run, and P-01 owns the DB — this file never resets
// or mutates it). Run `pnpm db:reset` first if the tenant doesn't exist.
const PERF_BUDGET_MS = 1500; // packet AC2 / lead ruling 3

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";

let institutionId: string;
let institutionSettings: Record<string, unknown>;

beforeAll(async () => {
  const [row] = await sql`select id, settings from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm db:reset` first.");
  institutionId = row.id as string;
  institutionSettings = (row.settings ?? {}) as Record<string, unknown>;
});

afterAll(async () => {
  await sql.end();
});

/** Real demo sign-in, with one retry (lead instruction) for a transient failure mid-reset. */
async function signInDemo(loginKey: string, retry = true): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error } = await client.auth.signInWithPassword({
    email: `${loginKey}@demo.coolskool.test`,
    password: SEED_PASSWORD,
  });
  if (error) {
    if (retry) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return signInDemo(loginKey, false);
    }
    throw error;
  }
  return client;
}

/** Builds a real TenantContext for a seeded demo user, same shape as tests/helpers/actions.ts's buildContext but keyed by login email, not a throwaway fixture. */
async function buildDemoContext(loginKey: string, role: Role): Promise<{ ctx: TenantContext; client: SupabaseClient<Database> }> {
  const client = await signInDemo(loginKey);
  const [user] = await sql`select id from auth.users where email = ${`${loginKey}@demo.coolskool.test`}`;
  const [membership] = await sql`
    select staff_id, guardian_id, student_id from public.memberships
    where institution_id = ${institutionId} and user_id = ${user.id} and status = 'active'
  `;
  const [profile] = await sql`select full_name, phone, avatar_path, is_platform_admin from public.profiles where id = ${user.id}`;
  const [institution] = await sql`select slug, name, ai_policy, is_demo from public.institutions where id = ${institutionId}`;

  const ctx: TenantContext = {
    institution: {
      id: institutionId,
      slug: institution.slug as string,
      name: institution.name as string,
      settings: institutionSettings,
      ai_policy: institution.ai_policy as TenantContext["institution"]["ai_policy"],
      is_demo: institution.is_demo as boolean,
    },
    user: {
      id: user.id as string,
      profile: {
        fullName: profile.full_name,
        phone: profile.phone,
        avatarPath: profile.avatar_path,
        isPlatformAdmin: profile.is_platform_admin,
      },
    },
    membership: {
      role,
      staffId: membership.staff_id,
      guardianId: membership.guardian_id,
      studentId: membership.student_id,
    },
    permissions: new Set(permissionsFor(role)),
  };
  return { ctx, client };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - start };
}

describe("T-039 dashboard aggregates (seeded demo tenant, real RLS)", () => {
  it("teacher lacks dashboard.view — the page gate rejects before any aggregate runs (07 §2.2)", async () => {
    const { ctx } = await buildDemoContext("teacher.vi-a", "teacher");
    expect(() => requirePermission(ctx, "dashboard.view")).toThrow(AppError);
  });

  it("attendanceTodaySummary runs under principal RLS, within budget, as a valid percentage", async () => {
    const { ctx, client } = await buildDemoContext("principal", "principal");
    setActingClient(client);
    try {
      const { result, ms } = await timed(() => attendanceTodaySummary(ctx));
      expect(result.percentage).toBeGreaterThanOrEqual(0);
      expect(result.percentage).toBeLessThanOrEqual(100);
      expect(result.presentWeighted).toBeLessThanOrEqual(result.totalInDenominator);
      // AC2 / lead ruling 3 — scoped to today's date, so this should stay
      // fast even before P-01's 20261028000020_rls_performance.sql merges
      // (that fix targets unfiltered institution-wide counts/scans).
      expect(ms).toBeLessThan(PERF_BUDGET_MS);
    } finally {
      setActingClient(null);
    }
  }, 20_000);

  it("sectionsBelowThreshold runs under principal RLS, within budget, listing only sections below the critical threshold", async () => {
    const { ctx, client } = await buildDemoContext("principal", "principal");
    setActingClient(client);
    try {
      const { result, ms } = await timed(() => sectionsBelowThreshold(ctx));
      expect(Array.isArray(result)).toBe(true);
      for (const alert of result) {
        expect(typeof alert.classSectionId).toBe("string");
        expect(typeof alert.label).toBe("string");
        expect(alert.percentage).toBeGreaterThanOrEqual(0);
      }
      // AC4 — worst-first ordering.
      for (let i = 1; i < result.length; i++) {
        expect(result[i].percentage).toBeGreaterThanOrEqual(result[i - 1].percentage);
      }
      expect(ms).toBeLessThan(PERF_BUDGET_MS);
    } finally {
      setActingClient(null);
    }
  }, 20_000);

  it("admissionsFunnel (getAdmissionsFunnelCounts) runs under principal RLS", async () => {
    const { ctx, client } = await buildDemoContext("principal", "principal");
    setActingClient(client);
    try {
      const { result } = await timed(() => getAdmissionsFunnelCounts(ctx));
      expect(typeof result.enquiryStages).toBe("object");
      expect(typeof result.applicationStatuses).toBe("object");
    } finally {
      setActingClient(null);
    }
  });

  it("examGradeDistribution runs under exam_controller RLS and its distribution sums to its own total", async () => {
    const { ctx, client } = await buildDemoContext("examcontroller", "exam_controller");
    setActingClient(client);
    try {
      const { result } = await timed(() => examGradeDistribution(ctx));
      // Null until an exam is published (T-021 seed not yet landed) — not a failure of this query.
      if (result) {
        const sum = Object.values(result.distribution).reduce((a, b) => a + b, 0);
        expect(sum).toBe(result.total);
      }
    } finally {
      setActingClient(null);
    }
  });

  it("termCollectionSummary runs under accountant RLS and never shows collected > due", async () => {
    const { ctx, client } = await buildDemoContext("accountant", "accountant");
    setActingClient(client);
    try {
      const [year] = await sql`select id from public.academic_years where institution_id = ${institutionId} order by starts_on desc limit 1`;
      const [term] = year
        ? await sql`select id from public.terms where academic_year_id = ${year.id} order by sequence limit 1`
        : [undefined];
      if (!term) return; // finance seed (T-033) not yet landed — nothing to assert against.

      const { result } = await timed(() => termCollectionSummary(ctx, term.id as string));
      expect(result.collectedPaise).toBeLessThanOrEqual(result.duePaise);
    } finally {
      setActingClient(null);
    }
  });

  it("getDashboardData hides finance for exam_controller (07 §2.2) regardless of seed state", async () => {
    const { ctx, client } = await buildDemoContext("examcontroller", "exam_controller");
    setActingClient(client);
    try {
      const dashboard = await getDashboardData(ctx);
      expect(dashboard.collections).toBeNull();
      expect(dashboard.recentActivity).toBeNull(); // exam_controller also lacks notification.log.read
    } finally {
      setActingClient(null);
    }
  }, 20_000);

  it("getDashboardData computes finance for accountant when a term exists (AC3)", async () => {
    const { ctx, client } = await buildDemoContext("accountant", "accountant");
    setActingClient(client);
    try {
      const [year] = await sql`select id from public.academic_years where institution_id = ${institutionId} limit 1`;
      const dashboard = await getDashboardData(ctx);
      if (year) {
        expect(dashboard.collections).not.toBeNull();
      } else {
        expect(dashboard.collections).toBeNull(); // no academic year seeded at all
      }
    } finally {
      setActingClient(null);
    }
  }, 20_000);
});
