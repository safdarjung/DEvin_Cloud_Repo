import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidV5 } from "../../scripts/seed/lib/ids.ts";

// X04-T10 (seed section `fee-plans`). Reads the already-seeded demo
// tenant — run `pnpm demo:reset` before this file (same convention as
// tests/db/seed-finance.test.ts; reseeding ~6,000 invoices per run is too
// slow to redo here).
//
// Determinism is checked as a pure function of stored natural keys
// (fee_structure_id for rules; admission_no + seq for instalments)
// rather than via a second full `pnpm demo:reset` + re-compare: which
// admission numbers land in the "first 24 by invoice_no" pick is not
// itself guaranteed stable across reseeds (invoice_no is assigned by
// racing concurrent app.generate_invoice calls — see finance.ts's header
// and tests/db/seed-determinism.test.ts's financeFingerprint comment),
// only that whichever invoice is picked gets ids derived the same way
// every time. tests/db/seed-determinism.test.ts already exercises a real
// reset + reseed for the sections whose ids are reset-order-independent.

const PER_DAY_GRADES = ["I", "II", "III", "IV", "V"];
const FLAT_GRADES = ["XI", "XII"];
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

describe("X04-T10 seed section fee-plans — late_fee_rules", () => {
  it("exists only on grade I-V and XI-XII fee structures (14 rows, both with/without-transport variants)", async () => {
    const rows = await sql`
      select g.code
      from public.late_fee_rules r
      join public.fee_structures fs on fs.id = r.fee_structure_id
      join public.grades g on g.id = fs.grade_id
      where r.institution_id = ${institutionId}
    `;
    expect(rows.length).toBe(14);
    const codes = new Set(rows.map((r) => r.code as string));
    expect(codes).toEqual(new Set(PER_DAY_GRADES.concat(FLAT_GRADES)));
  });

  it("is per_day ₹10/grace 5/cap ₹300 for I-V and flat ₹250/grace 7 for XI-XII", async () => {
    const rows = await sql`
      select g.code, r.kind, r.amount, r.grace_days, r.cap
      from public.late_fee_rules r
      join public.fee_structures fs on fs.id = r.fee_structure_id
      join public.grades g on g.id = fs.grade_id
      where r.institution_id = ${institutionId}
    `;
    for (const row of rows) {
      if (PER_DAY_GRADES.includes(row.code as string)) {
        expect(row.kind).toBe("per_day");
        expect(Number(row.amount)).toBe(10);
        expect(row.grace_days).toBe(5);
        expect(Number(row.cap)).toBe(300);
      } else {
        expect(row.kind).toBe("flat");
        expect(Number(row.amount)).toBe(250);
        expect(row.grace_days).toBe(7);
        expect(row.cap).toBeNull();
      }
    }
  });

  it("gives every rule id a value deterministic in fee_structure_id", async () => {
    const rows = await sql`select id, fee_structure_id from public.late_fee_rules where institution_id = ${institutionId}`;
    for (const row of rows) {
      expect(row.id).toBe(uuidV5("fee-plans", `rule:${row.fee_structure_id}`));
    }
  });
});

describe("X04-T10 seed section fee-plans — invoice_instalments", () => {
  it("writes exactly 24 three-part plans, each summing to app.invoice_principal", async () => {
    const plans = await sql`
      select ii.invoice_id, sum(ii.amount) as total, count(*)::int as parts
      from public.invoice_instalments ii
      join public.invoices i on i.id = ii.invoice_id
      where ii.institution_id = ${institutionId} and i.term_id = ${term2Id}
      group by ii.invoice_id
    `;
    expect(plans.length).toBe(24);
    for (const plan of plans) {
      expect(plan.parts).toBe(3);
      const [principalRow] = await sql`select app.invoice_principal(${plan.invoice_id}::uuid) as principal`;
      expect(Number(plan.total)).toBeCloseTo(Number(principalRow.principal), 2);
    }
  });

  it("only plans grade I-V/XI-XII Term 2 invoices", async () => {
    const rows = await sql`
      select distinct g.code
      from public.invoice_instalments ii
      join public.invoices i on i.id = ii.invoice_id
      join public.students s on s.id = i.student_id
      join public.enrolments e on e.student_id = s.id and e.status = 'active'
      join public.class_sections cs on cs.id = e.class_section_id
      join public.grades g on g.id = cs.grade_id
      where ii.institution_id = ${institutionId} and i.term_id = ${term2Id}
    `;
    const codes = rows.map((r) => r.code as string);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) expect(PER_DAY_GRADES.concat(FLAT_GRADES)).toContain(code);
  });

  it("has at least one overdue part via invoice_instalment_status", async () => {
    const rows = await sql`select * from public.invoice_instalment_status(${institutionId}::uuid, ${term2Id}::uuid)`;
    const overdue = rows.filter((r) => r.status === "overdue");
    expect(overdue.length).toBeGreaterThanOrEqual(1);
  });

  it("gives every instalment id a value deterministic in (admission_no, seq)", async () => {
    const rows = await sql`
      select ii.id, ii.seq, s.admission_no
      from public.invoice_instalments ii
      join public.invoices i on i.id = ii.invoice_id
      join public.students s on s.id = i.student_id
      where ii.institution_id = ${institutionId} and i.term_id = ${term2Id}
    `;
    expect(rows.length).toBe(72); // 24 plans * 3 parts
    for (const row of rows) {
      expect(row.id).toBe(uuidV5("fee-plans", `instalment:${row.admission_no}:${row.seq}`));
    }
  });

  it("charges no late fee yet (date-dependent application deferred to the runner)", async () => {
    const [row] = await sql`select count(*)::int as n from public.late_fee_charges where institution_id = ${institutionId}`;
    expect(row.n).toBe(0);
  });
});
