import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInDemo } from "../helpers/demo-context";
import { sectionNames } from "../../scripts/seed/lib/grades.ts";
import { uuidV5 } from "../../scripts/seed/lib/ids.ts";

// Owner decision (2026-11-07): seed section `homework` (scripts/seed/sections/
// homework.ts) — the demo student section must not be empty. Reads the
// already-seeded demo tenant (same convention as tests/db/seed-visitors.test.ts);
// the last test triggers its own reseed to check determinism.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const repoRoot = path.resolve(import.meta.dirname, "../..");

function runDemoReset(): void {
  execFileSync("node", ["--env-file-if-exists=.env.local", "scripts/demo-reset.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DEMO_RESET_ALLOWED: "true" },
    stdio: "pipe",
  });
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

const HOMEWORK_SECTIONS = ["VI", "VIII", "X"].reduce((sum, code) => sum + sectionNames(code).length, 0);

describe("homework seed section", () => {
  it("seeds 3 assignments per section of grades VI/VIII/X plus 1 quiz for the 3 named sections", async () => {
    const [assignments] = await sql`select count(*)::int as n from public.assignments where institution_id = ${institutionId}`;
    expect(assignments.n).toBe(HOMEWORK_SECTIONS * 3 + 3);

    const [answerKeys] = await sql`select count(*)::int as n from public.assignment_answer_keys where institution_id = ${institutionId}`;
    expect(answerKeys.n).toBe(3);

    const [submissions] = await sql`select count(*)::int as n from public.assignment_submissions where institution_id = ${institutionId}`;
    expect(submissions.n).toBe(HOMEWORK_SECTIONS * (38 + 15));
  });

  it("student.one (Ananya, X-A) sees >=1 due, >=1 submitted, >=1 graded assignment via her own RLS client", async () => {
    const client = await signInDemo("student.one");

    const { data: assignments, error } = await client
      .from("assignments")
      .select("id, status, due_at")
      .eq("institution_id", institutionId);
    expect(error).toBeNull();
    const ids = (assignments ?? []).map((a) => a.id);
    expect(ids.length).toBeGreaterThan(0);

    const { data: submissions, error: subError } = await client
      .from("assignment_submissions")
      .select("assignment_id, status")
      .in("assignment_id", ids);
    expect(subError).toBeNull();

    const dueCount = (assignments ?? []).filter((a) => a.due_at && new Date(a.due_at) > new Date()).length;
    const submittedCount = (submissions ?? []).filter((s) => s.status === "submitted").length;
    const gradedCount = (submissions ?? []).filter((s) => s.status === "graded").length;

    expect(dueCount).toBeGreaterThanOrEqual(1);
    expect(submittedCount).toBeGreaterThanOrEqual(1);
    expect(gradedCount).toBeGreaterThanOrEqual(1);

    await client.auth.signOut();
  });

  it("student.one sees >=3 notifications via her own RLS client", async () => {
    const client = await signInDemo("student.one");
    const { data, error } = await client.from("notifications").select("id, type, read_at");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(3);
    await client.auth.signOut();
  });

  it("gives identical assignment/answer-key ids across a reset + reseed", async () => {
    const before = await sql`
      select id from public.assignments where institution_id = ${institutionId}
      union select id from public.assignment_answer_keys where institution_id = ${institutionId}
      order by id
    `;
    const beforeIds = before.map((r) => r.id as string);
    expect(beforeIds.length).toBe(HOMEWORK_SECTIONS * 3 + 3 + 3);

    runDemoReset();

    const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    const afterInstitutionId = row!.id as string;
    const after = await sql`
      select id from public.assignments where institution_id = ${afterInstitutionId}
      union select id from public.assignment_answer_keys where institution_id = ${afterInstitutionId}
      order by id
    `;
    const afterIds = after.map((r) => r.id as string);
    expect(afterIds).toEqual(beforeIds);

    // Spot check the fixed uuidV5 formula too (X-A's quiz, homework.ts's QUIZ_SUBJECT_CODE).
    const expectedQuizId = uuidV5("homework", "assignment:X-A:MATH:quiz");
    const [quiz] = await sql`
      select 1 as found from public.assignments where id = ${expectedQuizId} and institution_id = ${afterInstitutionId}
    `;
    expect(quiz).toBeTruthy();
  }, 180_000);
});
