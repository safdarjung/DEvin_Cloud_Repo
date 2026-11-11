import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseGraph } from "../../src/modules/workflows/graph.ts";
import { WORKFLOW_TEMPLATES } from "../../src/modules/workflows/templates.ts";

// M23-T20 (seed section `workflows`). Reads the already-seeded demo tenant —
// run `pnpm demo:reset` before this file (same convention as
// tests/db/seed-staffing.test.ts); the last test triggers its own reseed to
// check id determinism, mirroring tests/db/seed-determinism.test.ts.

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

describe("M23-T20 seed section workflows", () => {
  it("has 5 active workflows with the template names", async () => {
    const rows = await sql`
      select name, status, version, trigger_type, trigger_config, nodes, edges
      from public.workflows where institution_id = ${institutionId} order by name
    `;
    expect(rows.length).toBe(5);
    const names = rows.map((r) => r.name as string).sort();
    expect(names).toEqual(WORKFLOW_TEMPLATES.map((t) => t.name).sort());
    for (const row of rows) {
      expect(row.status).toBe("active");
      expect(row.version).toBe(1);
    }
  });

  it("every stored graph passes parseGraph", async () => {
    const rows = await sql`
      select name, nodes, edges from public.workflows where institution_id = ${institutionId}
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const result = parseGraph({ nodes: row.nodes, edges: row.edges });
      expect(result.ok, `${row.name as string}: ${!result.ok ? result.errors.join("; ") : ""}`).toBe(true);
    }
  });

  it("the 4 schedule workflows have next_run_at in the future", async () => {
    const rows = await sql`
      select name, next_run_at from public.workflows
      where institution_id = ${institutionId} and trigger_type = 'schedule'
    `;
    expect(rows.length).toBe(4);
    const now = Date.now();
    for (const row of rows) {
      expect(row.next_run_at).not.toBeNull();
      expect(new Date(row.next_run_at as string).getTime()).toBeGreaterThan(now);
    }
  });

  it("the event workflow has no next_run_at", async () => {
    const rows = await sql`
      select next_run_at from public.workflows
      where institution_id = ${institutionId} and trigger_type = 'event'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.next_run_at).toBeNull();
  });

  // The workflow-runs seed section adds finished history for the demo (done, failed, awaiting approval).
  // Nothing may be left running or queued: a reseed must never make the job runner execute a workflow.
  it("seeds only finished or waiting runs and queues no workflow jobs", async () => {
    const live = await sql`select id from public.workflow_runs where institution_id = ${institutionId} and status in ('running', 'queued')`;
    expect(live.length).toBe(0);
    const jobs = await sql`select id from public.jobs where institution_id = ${institutionId} and type = 'workflow.run' and status in ('queued', 'running')`;
    expect(jobs.length).toBe(0);
  });

  it("gives identical workflow ids across a reset + reseed", async () => {
    const fingerprint = async (inst: string) =>
      (await sql`select id, name from public.workflows where institution_id = ${inst} order by name`).map((r) => ({
        id: r.id as string,
        name: r.name as string,
      }));

    const before = await fingerprint(institutionId);
    expect(before.length).toBe(5);

    runDemoReset();

    const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
    const after = await fingerprint(row!.id as string);
    expect(after).toEqual(before);
  }, 180_000);
});
