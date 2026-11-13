import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInDemo } from "../helpers/demo-context";
import { RLS_EXPECTATIONS } from "./rls-expectations";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

// M27-T5: roles with a real seeded demo login (`scripts/seed/sections/core.ts`
// DEMO_LOGINS), mapped to the login key `signInDemo` expects. `owner` has no
// demo login (rulings §"RLS suite extension (T4, T5)") and is never probed.
const DEMO_ROLE_LOGINS: Record<string, string> = {
  principal: "principal",
  admin: "admin",
  admissions: "admissions",
  accountant: "accountant",
  exam_controller: "examcontroller",
  teacher: "teacher.vi-a",
  guardian: "guardian.one",
  student: "student.one",
};

// Tables the seed intentionally leaves at 0 demo rows (M27-T2/T3 reports +
// the fabric ruling's "Not seeded, by design" list). Every tenant table NOT
// in this set must hold >=1 demo row — otherwise "0 rows" proves nothing
// (there was nothing to leak), and the deny probe below would be vacuous.
const EMPTY_IN_DEMO = new Set<string>([
  "alumni_profiles", // §8.1 fixes students at 3,024 (all statuses); no graduated student in demo, /alumni shows its empty state
  "briefings", // M25 ruling: generated lazily per calling user, never seeded
  "documents", // no document uploaded in the demo tenant
  "late_fee_charges", // X04: no overdue instalment charged in the demo tenant
  "safety_alert_sections", // 0129: seeded alerts target all/staff, none targets specific sections
  "student_lifecycle_events", // M14: no lifecycle event recorded in the demo tenant
  "dashboard_preferences", // 0135: no custom layout saved in the demo tenant
  "curriculum_materials", // 0139: uploads need a real stored file; none is uploaded in the demo tenant
  "timetable_snapshots", // 0141: snapshots are saved by a manager before a risky edit; none is saved in the demo tenant
  "ai_proposals", // 0143: task cards exist only while a person is working in the orb; none is seeded
  "question_collections", // 0146: personal question sets; none is seeded yet
  "question_collection_items", // 0146: follows question_collections
  "curriculum_topics", // 0147: unit topics are entered by the school; none is seeded yet
]);

// Roles that read only the rows they take part in. The demo seed gives the demo teacher, guardian and student
// rows of their own in these tables, so "0 rows" is no longer the right claim for them here; that they see nobody
// else's rows is proved in tests/db/messaging-rls.test.ts and tests/db/practice-rls.test.ts.
const PARTICIPANT_SCOPED: Record<string, readonly string[]> = {
  message_threads: ["teacher", "guardian"],
  messages: ["teacher", "guardian"],
  practice_attempts: ["teacher", "guardian", "student"],
};

// Same exclusion as rls-generated.test.ts's cross-institution suite:
// `profiles` has no institution_id column (global); `institutions` is the
// tenant root itself, keyed by `id` not `institution_id`.
const PROBED_TABLES = Object.keys(RLS_EXPECTATIONS).filter(
  (t) => t !== "profiles" && t !== "institutions",
);

let institutionId: string;
const clients = new Map<string, SupabaseClient>();

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm db:reset` first.");
  institutionId = row.id as string;

  await Promise.all(
    Object.entries(DEMO_ROLE_LOGINS).map(async ([role, loginKey]) => {
      clients.set(role, await signInDemo(loginKey));
    }),
  );
  clients.set(
    "anon",
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    ),
  );
}, 60_000);

afterAll(async () => {
  await sql.end();
});

describe("within-tenant deny probe on the seeded demo tenant (M27-T5)", () => {
  // Non-vacuity: a role denied on a table with 0 demo rows would pass even
  // if its policy let it read everything. Every probed table not in
  // EMPTY_IN_DEMO must have real rows to try (and fail) to leak.
  it("every probed table outside EMPTY_IN_DEMO has demo rows", async () => {
    const stillEmpty: string[] = [];
    for (const table of PROBED_TABLES) {
      if (EMPTY_IN_DEMO.has(table)) continue;
      const [{ count }] = await sql<{ count: number }[]>`
        select count(*)::int as count from public.${sql(table)} where institution_id = ${institutionId}
      `;
      if (count === 0) stillEmpty.push(table);
    }
    expect(stillEmpty).toEqual([]);
  });

  describe.each(PROBED_TABLES)("%s", (table) => {
    const expectation = RLS_EXPECTATIONS[table];
    const deniedRoles = Object.keys(DEMO_ROLE_LOGINS).filter(
      (role) => !expectation.read.includes(role as (typeof expectation.read)[number]) && !PARTICIPANT_SCOPED[table]?.includes(role),
    );
    // Class P only (T-023): anon has a SELECT policy for published/live rows.
    if (!expectation.anonRead) deniedRoles.push("anon");

    for (const role of deniedRoles) {
      it(`${role}: SELECT on the demo tenant returns 0 rows`, async () => {
        const client = clients.get(role)!;
        const columns = expectation.selectColumns?.join(",") ?? "institution_id";
        const { data, error } = await client
          .from(table)
          .select(columns)
          .eq("institution_id", institutionId);

        if (error) {
          // Denied at the grant layer (e.g. a column-restricted table) —
          // still proves the role cannot read the row, just one layer up.
          expect(error.code, `${table} / ${role}: unexpected error ${error.code} "${error.message}"`).toBe("42501");
        } else {
          expect(data).toHaveLength(0);
        }
      });
    }
  });
});
