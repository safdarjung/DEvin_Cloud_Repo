import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidV5 } from "../../scripts/seed/lib/ids.ts";

// M13-T11 (seed section `operations`). Reads the already-seeded demo
// tenant — run `pnpm demo:reset` before this file (same convention as
// tests/db/seed-timetable.test.ts); the last test triggers its own reseed
// to check determinism.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";
const repoRoot = path.resolve(import.meta.dirname, "../..");

function runDemoReset(): void {
  execFileSync("node", ["--env-file-if-exists=.env.local", "scripts/demo-reset.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DEMO_RESET_ALLOWED: "true" },
    stdio: "pipe",
  });
}

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

let institutionId: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
  institutionId = row.id as string;
}, 180_000);

afterAll(async () => {
  await sql.end();
});

describe("M13-T11 seed section operations — transport", () => {
  it("has 4 routes with at least 5 stops each", async () => {
    const rows = await sql`
      select r.id, count(s.id)::int as stop_count
      from public.transport_routes r
      left join public.transport_stops s on s.route_id = r.id
      where r.institution_id = ${institutionId}
      group by r.id
    `;
    expect(rows.length).toBe(4);
    for (const row of rows) expect(row.stop_count).toBeGreaterThanOrEqual(5);
  });

  it("Aarav (VI-A) and Ananya (X-A) are both assigned to Route 1 Stop 3", async () => {
    // Scoped by admission_no (05 §8.1), not first_name — the generic
    // roster's random names can coincidentally collide (attendance.ts's
    // own comment on this exact pitfall).
    const rows = await sql`
      select st.first_name, r.name as route_name, ts.seq
      from public.transport_assignments a
      join public.students st on st.id = a.student_id
      join public.transport_routes r on r.id = a.route_id
      join public.transport_stops ts on ts.id = a.stop_id
      where a.institution_id = ${institutionId}
        and st.admission_no in ('ADM/2024/00412', 'ADM/2020/00133')
      order by st.first_name
    `;
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.route_name).toBe("Route 1");
      expect(row.seq).toBe(3);
    }
  });

  it("no route has more assignments than its vehicle's capacity", async () => {
    const rows = await sql`
      select r.id, v.capacity, count(a.id)::int as assigned
      from public.transport_routes r
      join public.transport_vehicles v on v.id = r.vehicle_id
      left join public.transport_assignments a on a.route_id = r.id
      where r.institution_id = ${institutionId}
      group by r.id, v.capacity
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.assigned).toBeLessThanOrEqual(row.capacity);
  });

  it("guardian.one reads exactly one stop per child's route (RLS)", async () => {
    const client = await signInDemo("guardian.one");
    const { data, error } = await client.from("transport_stops").select("id, route_id, seq");
    expect(error).toBeNull();
    const routeIds = new Set((data ?? []).map((r) => r.route_id));
    expect(routeIds.size).toBeGreaterThanOrEqual(1);
    for (const routeId of routeIds) {
      const stopsOnRoute = (data ?? []).filter((r) => r.route_id === routeId);
      expect(stopsOnRoute.length).toBe(1);
    }
    await client.auth.signOut();
  });
});

describe("M13-T11 seed section operations — facilities", () => {
  it("seeds ~20 assets and 8 maintenance requests (3 open, 3 in_progress, 2 done)", async () => {
    const [assets] = await sql`select count(*)::int as n from public.assets where institution_id = ${institutionId}`;
    expect(assets.n).toBeGreaterThanOrEqual(18);

    const rows = await sql`
      select status, count(*)::int as n from public.maintenance_requests
      where institution_id = ${institutionId} group by status
    `;
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    expect(byStatus.open).toBe(3);
    expect(byStatus.in_progress).toBe(3);
    expect(byStatus.done).toBe(2);
  });
});

describe("M13-T11 seed section operations — calendar / holiday block", () => {
  it("no attendance session falls on a seeded holiday", async () => {
    const rows = await sql`
      select s.id from public.attendance_sessions s
      join public.academic_calendar_events e
        on e.institution_id = s.institution_id
        and e.kind = 'holiday'
        and s.date between e.starts_on and e.ends_on
      where s.institution_id = ${institutionId}
    `;
    expect(rows.length).toBe(0);
  });

  it("holiday events cover exactly the attendance seed's holiday dates", async () => {
    const rows = await sql`
      select starts_on, ends_on from public.academic_calendar_events
      where institution_id = ${institutionId} and kind = 'holiday' order by starts_on
    `;
    const dates = rows.map((r) => ({ starts: r.starts_on.toISOString().slice(0, 10), ends: r.ends_on.toISOString().slice(0, 10) }));
    expect(dates).toEqual([
      { starts: "2026-08-15", ends: "2026-08-15" },
      { starts: "2026-10-02", ends: "2026-10-02" },
      { starts: "2026-10-20", ends: "2026-10-22" },
      { starts: "2026-12-25", ends: "2026-12-25" },
      { starts: "2027-01-26", ends: "2027-01-26" },
    ]);
  });
});

describe("M13-T11 determinism", () => {
  it("gives identical transport_assignment ids across a reset + reseed", async () => {
    const before = await sql`
      select id from public.transport_assignments where institution_id = ${institutionId} order by id
    `;
    const beforeIds = before.map((r) => r.id as string);
    expect(beforeIds.length).toBeGreaterThan(0);

    runDemoReset();

    const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    const afterInstitutionId = row!.id as string;
    const after = await sql`
      select id from public.transport_assignments where institution_id = ${afterInstitutionId} order by id
    `;
    const afterIds = after.map((r) => r.id as string);
    expect(afterIds).toEqual(beforeIds);

    // Spot check the fixed uuidV5 formula too.
    const expectedVehicleId = uuidV5("operations", "vehicle:0");
    const [vehicle] = await sql`
      select 1 as found from public.transport_vehicles where id = ${expectedVehicleId} and institution_id = ${afterInstitutionId}
    `;
    expect(vehicle).toBeTruthy();
  }, 180_000);
});
