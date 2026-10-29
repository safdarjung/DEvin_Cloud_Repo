import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// T-013 AC3 (05 §8: "every run produces identical ids... names, and
// numbers"). Unlike tests/db/demo-reset.test.ts (which only exercises
// `app.demo_reset` against throwaway institutions it creates and deletes
// itself), this test genuinely resets + reseeds the shared `st-josephs-demo`
// singleton — the same thing `pnpm demo:reset` does. That's only safe
// because vitest.config.mts sets `fileParallelism: false` for the "db"
// project, so db test files run one at a time and nothing else reads this
// tenant mid-reseed. Do not parallelize this project without reconsidering
// this test.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const repoRoot = path.resolve(import.meta.dirname, "../..");

function runDemoReset(): void {
  execFileSync("node", ["--env-file-if-exists=.env.local", "scripts/demo-reset.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DEMO_RESET_ALLOWED: "true" },
    stdio: "pipe",
  });
}

async function admissionFingerprint(): Promise<string> {
  const rows = await sql`
    select admission_no, id from public.students
    where institution_id = (select id from public.institutions where slug = 'st-josephs-demo')
    order by 1
  `;
  const hash = crypto.createHash("sha256");
  for (const row of rows) hash.update(`${row.admission_no}:${row.id}`);
  return `${hash.digest("hex")}:${rows.length}`;
}

beforeAll(async () => {
  const [row] = await sql`
    select count(*)::int as n from public.students
    where institution_id = (select id from public.institutions where slug = 'st-josephs-demo')
  `;
  // Self-contained: seed once first if the demo tenant isn't already seeded,
  // so this test doesn't depend on a prior manual `pnpm demo:reset`.
  if (!row || row.n === 0) runDemoReset();
}, 60_000);

afterAll(async () => {
  await sql.end();
});

describe("T-013 seed determinism (AC3)", () => {
  it("produces identical (admission_no, id) pairs across a reset + reseed", async () => {
    const before = await admissionFingerprint();

    runDemoReset();

    const after = await admissionFingerprint();
    expect(after).toBe(before);
  }, 60_000);
});
