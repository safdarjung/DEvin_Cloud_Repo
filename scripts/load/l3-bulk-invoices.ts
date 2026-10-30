// T-043 L3 — bulk invoice generation (08 §6 / 09 Day 15,17). Times
// `finance.generate_term_invoices` (src/modules/jobs/handlers/
// finance.generate_term_invoices.ts) end to end for a fresh term over the
// seeded institution's active enrolments (3,024 students, 05 §8), runs
// `EXPLAIN ANALYZE` of `app.generate_invoice` once (rolled back — it
// writes rows), and samples `pg_stat_activity` for lock waits while the
// job runs.
//
// Reuses the real job pipeline (`createScriptAdminClient` +
// `runOnceCore`, same as `scripts/jobs-run.ts`) rather than calling
// `generate_invoice` in a hand-rolled loop, so the measured wall time is
// the real production path including the handler's own 40s soft budget
// and the runner's claim/complete cycle (06 §7). The harness fast-forwards
// `run_after` between attempts instead of sleeping out the real
// `2^attempts` minute backoff (0003 `app.complete_job`) — see "backoff"
// in the result file if more than one attempt was needed; that backoff
// magnitude is itself a candidate follow-up for the jobs lane, not fixed
// here (packet: "must not modify application code").
import postgres from "postgres";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createScriptAdminClient } from "../lib/admin-client.ts";
import { createRunnerPorts, runOnceCore } from "../../src/modules/jobs/runner.ts";
import { requireLoadTarget } from "./auth.ts";

const SLUG = "st-josephs-demo";
const MAX_WALL_MS = 10 * 60_000;

class IntentionalRollback extends Error {}

async function main(): Promise<void> {
  requireLoadTarget();
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is not set");
  const sql = postgres(dbUrl, { max: 1 });

  try {
    const [institution] = await sql`select id from public.institutions where slug = ${SLUG}`;
    if (!institution) throw new Error("demo institution not found — run pnpm seed first");
    const institutionId = institution.id as string;

    const [year] = await sql`select id, starts_on, ends_on from public.academic_years where institution_id = ${institutionId} and is_current`;
    if (!year) throw new Error("no current academic year for the demo institution");

    const [term] = await sql`
      insert into public.terms (institution_id, academic_year_id, name, sequence, starts_on, ends_on)
      values (${institutionId}, ${year.id}, 'Load Test Term (T-043, ignore)', 99, ${year.starts_on}, ${year.ends_on})
      returning id`;
    const termId = term.id as string;

    const [sample] = await sql`
      select student_id from public.enrolments
      where institution_id = ${institutionId} and status = 'active'
      limit 1`;
    if (!sample) throw new Error("no active enrolments found for the demo institution");

    // EXPLAIN ANALYZE once, rolled back (the function writes an invoice).
    const explainSqlText = readFileSync(new URL("./l3-bulk-invoices.sql", import.meta.url), "utf8");
    let explainPlan = "";
    try {
      await sql.begin(async (tx) => {
        const rows = await tx.unsafe(explainSqlText, [sample.student_id, termId]);
        explainPlan = rows.map((r: Record<string, string>) => r["QUERY PLAN"]).join("\n");
        throw new IntentionalRollback();
      });
    } catch (err) {
      if (!(err instanceof IntentionalRollback)) throw err;
    }

    const [{ count: enrolmentCount }] = await sql`
      select count(*)::int as count from public.enrolments
      where institution_id = ${institutionId} and status = 'active'`;

    const idempotencyKey = `load-l3-${termId}`;
    await sql`select app.enqueue_job(${institutionId}::uuid, 'finance.generate_term_invoices', ${sql.json({ term_id: termId, grade_id: null })}, ${idempotencyKey})`;

    process.env.SERVICE_ROLE_CALLER = "jobs";
    const admin = createScriptAdminClient();
    const ports = createRunnerPorts(admin);
    const workerId = `load-l3-${process.pid}`;

    const lockSamples: Array<{ at: string; pid: number; waitEvent: string; query: string }> = [];
    let sampling = true;
    const samplingLoop = (async () => {
      while (sampling) {
        const rows = await sql`
          select pid, wait_event, query from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`;
        for (const row of rows) {
          lockSamples.push({ at: new Date().toISOString(), pid: row.pid, waitEvent: row.wait_event, query: row.query });
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    })();

    const wallStart = Date.now();
    let attempts = 0;
    let finalStatus = "queued";
    while (Date.now() - wallStart < MAX_WALL_MS) {
      await runOnceCore({ workerId }, ports);
      attempts += 1;
      const [job] = await sql`select status from public.jobs where idempotency_key = ${idempotencyKey}`;
      finalStatus = job?.status ?? "missing";
      if (finalStatus === "succeeded" || finalStatus === "dead") break;
      // Fast-forward the backoff instead of sleeping out `2^attempts`
      // minutes (see file header) — keep measuring processing time, not
      // harness idle time.
      await sql`update public.jobs set run_after = now() where idempotency_key = ${idempotencyKey} and status = 'queued'`;
    }
    const wallMs = Date.now() - wallStart;

    sampling = false;
    await samplingLoop;

    const [{ count: invoiceCount }] = await sql`
      select count(*)::int as count from public.invoices where institution_id = ${institutionId} and term_id = ${termId}`;

    const result = {
      scenario: "L3 bulk invoice generation",
      students: enrolmentCount,
      termId,
      attempts,
      finalStatus,
      wallMs,
      invoicesGenerated: invoiceCount,
      rowsPerSecond: wallMs > 0 ? Math.round((invoiceCount / wallMs) * 1000 * 100) / 100 : 0,
      lockWaitSamples: lockSamples.length,
      lockWaitDetail: lockSamples.slice(0, 20),
      explainPlan,
      note:
        attempts > 1
          ? `job needed ${attempts} attempts (40s soft budget, 06 §7) — harness skipped the real 2^attempts-minute backoff; file as a follow-up if this repeats in a hosted run.`
          : "completed in a single attempt (within the 40s soft budget).",
    };

    console.log(JSON.stringify({ ...result, explainPlan: undefined }, null, 2));
    console.log("---- EXPLAIN ANALYZE ----");
    console.log(explainPlan);

    mkdirSync("scripts/load/out", { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(`scripts/load/out/l3-${stamp}.json`, JSON.stringify(result, null, 2));
    writeFileSync(
      `scripts/load/out/l3-${stamp}.md`,
      `# L3 bulk invoice generation\n\n| students | attempts | final status | wall (ms) | invoices | rows/s | lock-wait samples |\n` +
        `|---|---|---|---|---|---|---|\n` +
        `| ${result.students} | ${result.attempts} | ${result.finalStatus} | ${result.wallMs} | ${result.invoicesGenerated} | ${result.rowsPerSecond} | ${result.lockWaitSamples} |\n\n` +
        `${result.note}\n\n## EXPLAIN ANALYZE (app.generate_invoice, 1 call, rolled back)\n\n\`\`\`\n${explainPlan}\n\`\`\`\n`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error("load:l3 failed:", err);
  process.exit(1);
});
