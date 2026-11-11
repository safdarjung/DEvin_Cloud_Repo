import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Sections fabric-studio, workflow-runs, ai-usage, messaging, exam-extras, question-bank,
// student-study, finance-extras, data-ops, people-history. Reads the already-seeded demo tenant:
// run `pnpm seed --only <those sections>` (or a full seed) first. Read-only, so it never touches
// the tenant another session may be using.

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 2 });
let inst: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found; seed the demo tenant first.");
  inst = row.id as string;
});
afterAll(async () => {
  await sql.end();
});

const count = async (table: string): Promise<number> =>
  (await sql.unsafe(`select count(*)::int as n from public.${table} where institution_id = '${inst}'`))[0]!.n as number;

describe("new demo seed sections", () => {
  it("fills every table the sections own", async () => {
    const minimums: Record<string, number> = {
      simulation_scenarios: 4, studio_requests: 8, workflow_runs: 40, ai_usage_events: 300, announcements: 15,
      announcement_audiences: 15, message_threads: 5, messages: 10, answer_sheets: 100, result_remarks: 100,
      question_bank: 300, practice_attempts: 500, study_items: 100, study_preferences: 1, payment_reversals: 10,
      online_payment_intents: 6, scheduled_reports: 3, import_batches: 2, import_rows: 10, enrolment_status_history: 5, invitations: 5,
    };
    for (const [table, min] of Object.entries(minimums)) expect(await count(table), table).toBeGreaterThanOrEqual(min);
  });

  it("workflow runs cover done, failed and awaiting_approval, and every waiting run has a cursor", async () => {
    const rows = await sql`select status, count(*)::int as n, count(cursor_node_id)::int as cursors from public.workflow_runs where institution_id = ${inst} group by status`;
    const by = Object.fromEntries(rows.map((r) => [r.status as string, r]));
    expect(by.done!.n).toBeGreaterThan(by.failed!.n as number);
    expect(by.failed!.n).toBeGreaterThanOrEqual(2);
    expect(by.awaiting_approval!.n).toBeGreaterThanOrEqual(3);
    expect(by.awaiting_approval!.cursors).toBe(by.awaiting_approval!.n);
  });

  it("studio requests span submitted, proposed, approved and rejected", async () => {
    const rows = await sql`select distinct status from public.studio_requests where institution_id = ${inst}`;
    expect(rows.map((r) => r.status).sort()).toEqual(["approved", "proposed", "rejected", "submitted"]);
  });

  it("reversals post matching ledger entries", async () => {
    const [row] = await sql`select count(*)::int as n from public.payment_reversals r join public.ledger_entries l on l.payment_id = r.payment_id
      where r.institution_id = ${inst} and l.memo like r.kind || '%'`;
    expect(row!.n).toBeGreaterThan(0);
  });

  it("online intents satisfy the state constraint across created, paid and unreconciled", async () => {
    const rows = await sql`select distinct status from public.online_payment_intents where institution_id = ${inst}`;
    expect(rows.map((r) => r.status).sort()).toEqual(["created", "paid", "unreconciled"]);
  });
});
