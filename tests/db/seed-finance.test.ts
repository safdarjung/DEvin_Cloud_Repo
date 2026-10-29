import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// T-033 (05 §8 / §8.1 INV-T2-Aarav). Reads the already-seeded demo tenant —
// run `pnpm demo:reset` before this file (seeding 6,048 invoices is too
// slow to redo per test run).

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

let institutionId: string;
let term2Id: string;

beforeAll(async () => {
  const [row] = await sql`select id from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm demo:reset` first.");
  institutionId = row.id as string;
  const [term2] = await sql`select id from public.terms where institution_id = ${institutionId} and sequence = 2`;
  term2Id = term2.id as string;
});

afterAll(async () => {
  await sql.end();
});

describe("T-033 seed counts (AC2)", () => {
  // 24, not the packet's literal 12: two structures per grade (with/without
  // transport) are needed because a fee_assignment can only point at one
  // structure and ~40% of students opt into transport (see finance.ts header).
  it("produces 24 fee_structures (2 per grade) and 3,024 fee_assignments", async () => {
    const [structures] = await sql`select count(*)::int as n from public.fee_structures where institution_id = ${institutionId}`;
    const [assignments] = await sql`select count(*)::int as n from public.fee_assignments where institution_id = ${institutionId}`;
    expect(structures.n).toBe(24);
    expect(assignments.n).toBe(3024);
  });

  it("produces roughly 8% concession-bearing students and 6,048 invoices", async () => {
    const [concessionStudents] = await sql`
      select count(distinct fee_assignment_id)::int as n from public.concessions where institution_id = ${institutionId}
    `;
    expect(concessionStudents.n).toBeGreaterThan(3024 * 0.05);
    expect(concessionStudents.n).toBeLessThan(3024 * 0.12);

    const [invoices] = await sql`select count(*)::int as n from public.invoices where institution_id = ${institutionId}`;
    expect(invoices.n).toBe(6048);
  });

  it("receipts count equals payments count; roughly 70% (±5%) of invoice value is collected", async () => {
    const [payments] = await sql`select count(*)::int as n from public.payments where institution_id = ${institutionId}`;
    const [receipts] = await sql`select count(*)::int as n from public.receipts where institution_id = ${institutionId}`;
    expect(receipts.n).toBe(payments.n);

    const [row] = await sql`
      select
        (select coalesce(sum(total), 0) from public.invoices where institution_id = ${institutionId}) as invoiced,
        (select coalesce(sum(amount), 0) from public.payments where institution_id = ${institutionId}) as collected
    `;
    const ratio = Number(row.collected) / Number(row.invoiced);
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(0.75);
  });
});

describe("T-033 ledger balance (invariant)", () => {
  it("Σdebit = Σcredit across all seeded ledger_entries", async () => {
    const [row] = await sql`
      select coalesce(sum(debit), 0) as debit, coalesce(sum(credit), 0) as credit
      from public.ledger_entries where institution_id = ${institutionId}
    `;
    expect(Number(row.debit)).toBeCloseTo(Number(row.credit), 2);
  });

  it("invoice_no and receipt_no are gap-free per sequence", async () => {
    const invoiceNos = await sql`
      select (regexp_match(invoice_no, '(\\d+)$'))[1]::int as seq
      from public.invoices where institution_id = ${institutionId} order by seq
    `;
    for (let i = 0; i < invoiceNos.length; i++) expect(invoiceNos[i]!.seq).toBe(i + 1);

    const receiptNos = await sql`
      select (regexp_match(receipt_no, '(\\d+)$'))[1]::int as seq
      from public.receipts where institution_id = ${institutionId} order by seq
    `;
    for (let i = 0; i < receiptNos.length; i++) expect(receiptNos[i]!.seq).toBe(i + 1);
  });
});

describe("T-033 named demo entities (05 §8.1)", () => {
  // Scoped by (grade, section, roll_no) — not by name — because the generic
  // roster's random names can coincidentally collide with a named student's
  // full name elsewhere in the 3,024-student demo tenant (same caveat as
  // tests/db/seed-people-academics.test.ts).
  const NAMED = {
    Aarav: { gradeCode: "VI", sectionName: "A", rollNo: 7 },
    Ananya: { gradeCode: "X", sectionName: "A", rollNo: 12 },
    Ishaan: { gradeCode: "VIII", sectionName: "B", rollNo: 3 },
  } as const;

  async function invoiceFor(firstName: keyof typeof NAMED, termId: string) {
    const { gradeCode, sectionName, rollNo } = NAMED[firstName];
    const [row] = await sql`
      select i.status, i.total, i.paid_total, i.due_on
      from public.invoices i
      join public.enrolments e on e.student_id = i.student_id and e.status = 'active'
      join public.class_sections cs on cs.id = e.class_section_id
      join public.grades g on g.id = cs.grade_id
      where i.institution_id = ${institutionId} and i.term_id = ${termId}
        and g.code = ${gradeCode} and cs.name = ${sectionName} and e.roll_no = ${rollNo}
    `;
    return row;
  }

  it("INV-T2-Aarav: Term 2 invoice is unpaid", async () => {
    const row = await invoiceFor("Aarav", term2Id);
    expect(row).toBeTruthy();
    expect(row.status).toBe("issued");
    expect(Number(row.paid_total)).toBe(0);
  });

  it("Ananya's and Ishaan's Term 2 invoices are paid", async () => {
    for (const name of ["Ananya", "Ishaan"] as const) {
      const row = await invoiceFor(name, term2Id);
      expect(row).toBeTruthy();
      expect(row.status).toBe("paid");
    }
  });

  it("guardian.one's two children (Aarav, Ananya) have one Term 1 paid and one part-paid invoice", async () => {
    const [term1] = await sql`select id from public.terms where institution_id = ${institutionId} and sequence = 1`;
    const aarav = await invoiceFor("Aarav", term1.id as string);
    const ananya = await invoiceFor("Ananya", term1.id as string);
    const statuses = [aarav.status, ananya.status].sort();
    expect(statuses).toEqual(["paid", "part_paid"].sort());
  });
});
