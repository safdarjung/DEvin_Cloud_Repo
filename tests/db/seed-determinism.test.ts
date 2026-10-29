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

// T-021/T-029/T-033: same reruns-produce-identical-ids/numbers contract
// (05 §8), extended to the exams/admissions/finance sections. `id` is
// deliberately excluded from the exams/finance hashes: both
// app.apply_recheck_decision's v2 rows and every app.generate_invoice call
// use `gen_random_uuid()` for the new row's id (not a seed-deterministic
// uuidV5), so those ids are genuinely random every reseed by design — the
// deterministic contract is on the business fields (student_id/total/grade,
// invoice_no/total/status), not on every primary key.
async function examsFingerprint(): Promise<string> {
  const rows = await sql`
    select r.student_id, r.total, r.grade, r.version_no from public.results r
    join public.exams e on e.id = r.exam_id
    where e.institution_id = (select id from public.institutions where slug = 'st-josephs-demo')
      and r.superseded_by is null
    order by r.student_id
  `;
  const hash = crypto.createHash("sha256");
  for (const row of rows) hash.update(`${row.student_id}:${row.total}:${row.grade}:${row.version_no}`);
  return `${hash.digest("hex")}:${rows.length}`;
}

async function admissionsFingerprint(): Promise<string> {
  const rows = await sql`
    select id, application_no, status from public.applications
    where institution_id = (select id from public.institutions where slug = 'st-josephs-demo')
    order by application_no
  `;
  const hash = crypto.createHash("sha256");
  for (const row of rows) hash.update(`${row.id}:${row.application_no}:${row.status}`);
  return `${hash.digest("hex")}:${rows.length}`;
}

async function financeFingerprint(): Promise<string> {
  // Keyed by (admission_no, term sequence), not `invoice_no` or `id`:
  // finance.ts issues its ~6,048 generate_invoice/record_payment calls over
  // a concurrent connection pool for speed (05 §8.2's <60s target), so WHICH
  // student's call commits first — and therefore which invoice_no sequence
  // number that student receives — is not itself deterministic across
  // reseeds. The business invariant that matters (same student ends up
  // with the same total/status every reseed) is deterministic; the
  // arbitrary sequence-label-to-student assignment is not, by design.
  const rows = await sql`
    select s.admission_no, t.sequence as term_sequence, i.total, i.status
    from public.invoices i
    join public.students s on s.id = i.student_id
    join public.terms t on t.id = i.term_id
    where i.institution_id = (select id from public.institutions where slug = 'st-josephs-demo')
    order by s.admission_no, t.sequence
  `;
  const hash = crypto.createHash("sha256");
  for (const row of rows) hash.update(`${row.admission_no}:${row.term_sequence}:${row.total}:${row.status}`);
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
}, 180_000);

afterAll(async () => {
  await sql.end();
});

describe("T-013 seed determinism (AC3)", () => {
  it("produces identical (admission_no, id) pairs across a reset + reseed", async () => {
    const before = await admissionFingerprint();
    const examsBefore = await examsFingerprint();
    const admissionsBefore = await admissionsFingerprint();
    const financeBefore = await financeFingerprint();

    runDemoReset();

    const after = await admissionFingerprint();
    expect(after).toBe(before);
    expect(await examsFingerprint()).toBe(examsBefore);
    expect(await admissionsFingerprint()).toBe(admissionsBefore);
    expect(await financeFingerprint()).toBe(financeBefore);
    // 180s, not 60s: a full reseed now also runs admissions/finance/exams
    // (finance alone takes ~35s for its 6,048 generate_invoice/record_payment
    // RPCs), measured at ~70-80s end to end.
  }, 180_000);
});
