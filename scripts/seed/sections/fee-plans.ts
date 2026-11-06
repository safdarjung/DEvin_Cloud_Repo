import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// X04-T10 (X04-tasks.md Task 10 / rulings "Late-fee rule" + "Instalment
// plans"). late_fee_rules on every fee structure of grades I-V (per_day
// ₹10, grace 5, cap ₹300) and XI-XII (flat ₹250, grace 7) only — grades
// VI/VIII/X (05 §8.1 named students Aarav/Ishaan/Ananya) get no rule, so
// their invoices stay unfined. 3-part invoice_instalments (service role,
// insertBatch — never public.set_invoice_instalments, which would also
// require a live session) on the first 24 unpaid ('issued'/'part_paid')
// Term 2 invoices of those same 7 grades, ordered by invoice_no: part 1
// due on the invoice's own due_on (already in the past relative to any
// `pnpm demo:reset` run after 2026-10), parts 2/3 on fixed dates; the
// principal (app.invoice_principal — excludes late_fee/library_fine
// lines, though none exist yet at seed time) is split in paise with the
// remainder on part 3. No late fee is charged here (date-dependent, would
// break determinism) — the first runner tick applies them.
//
// Determinism: late_fee_rules.id is keyed off fee_structure_id, itself a
// deterministic uuidV5 (finance.ts) — stable across reseeds. invoice_
// instalments.id is keyed off (admission_no, seq), not invoice_id:
// invoice ids and invoice_no are gen_random_uuid()/race-assigned by
// concurrent app.generate_invoice calls (finance.ts header,
// tests/db/seed-determinism.test.ts's financeFingerprint comment) and are
// never part of the determinism contract, so neither is which exact 24
// admission numbers this "first by invoice_no" pick lands on across two
// separate reseeds — only that, for whichever invoice it does land on,
// the instalment ids it writes are a pure function of that invoice's
// student and part number.

const PER_DAY_GRADES = ["I", "II", "III", "IV", "V"];
const FLAT_GRADES = ["XI", "XII"];
const PLAN_COUNT = 24;
const PART2_DUE_ON = "2026-12-10";
const PART3_DUE_ON = "2027-02-10";

function moneyToPaise(raw: string): number {
  const [whole, fraction = ""] = raw.split(".");
  return Number(`${whole || "0"}${(fraction + "00").slice(0, 2)}`);
}

function paiseToMoney(paise: number): string {
  return `${Math.trunc(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

function ruleParamsFor(gradeCode: string): { kind: "flat" | "per_day"; amount: string; graceDays: number; cap: string | null } {
  if (PER_DAY_GRADES.includes(gradeCode)) return { kind: "per_day", amount: "10.00", graceDays: 5, cap: "300.00" };
  return { kind: "flat", amount: "250.00", graceDays: 7, cap: null };
}

export async function run(ctx: SeedContext): Promise<void> {
  const { data: existing } = await ctx.admin
    .from("late_fee_rules")
    .select("id")
    .eq("institution_id", ctx.institutionId)
    .limit(1)
    .maybeSingle();
  if (existing) return; // idempotent rerun guard (same pattern as finance.ts)

  const targetGrades = PER_DAY_GRADES.concat(FLAT_GRADES);
  const principalUserId = ctx.userIdByLogin["principal"];

  // ---- late_fee_rules: one row per fee structure of grades I-V/XI-XII ----
  const structures = await ctx.sql<{ id: string; code: string }[]>`
    select fs.id, g.code
    from public.fee_structures fs
    join public.grades g on g.id = fs.grade_id
    where fs.institution_id = ${ctx.institutionId}
      and g.code in ${ctx.sql(targetGrades)}
  `;

  const ruleRows = structures.map((structure) => {
    const params = ruleParamsFor(structure.code);
    return {
      id: uuidV5("fee-plans", `rule:${structure.id}`),
      institution_id: ctx.institutionId,
      fee_structure_id: structure.id,
      kind: params.kind,
      amount: params.amount,
      grace_days: params.graceDays,
      cap: params.cap,
      updated_by: principalUserId,
    };
  });
  await insertBatch(ctx.admin, "late_fee_rules", ruleRows);

  // ---- invoice_instalments: first 24 unpaid Term 2 invoices of those grades, by invoice_no ----
  const invoices = await ctx.sql<{ invoiceId: string; dueOn: string; admissionNo: string; principal: string }[]>`
    select
      i.id as "invoiceId",
      i.due_on::text as "dueOn",
      s.admission_no as "admissionNo",
      app.invoice_principal(i.id)::text as "principal"
    from public.invoices i
    join public.students s on s.id = i.student_id
    join public.enrolments e on e.student_id = i.student_id and e.status = 'active'
    join public.class_sections cs on cs.id = e.class_section_id
    join public.grades g on g.id = cs.grade_id
    where i.institution_id = ${ctx.institutionId}
      and i.term_id = ${ctx.termIds.term2}
      and i.status in ('issued', 'part_paid')
      and g.code in ${ctx.sql(targetGrades)}
    order by i.invoice_no
    limit ${PLAN_COUNT}
  `;

  const instalmentRows: Record<string, unknown>[] = [];
  for (const invoice of invoices) {
    const principalPaise = moneyToPaise(invoice.principal);
    const part = Math.floor(principalPaise / 3);
    const partsPaise = [part, part, principalPaise - part * 2];
    const dueDates = [invoice.dueOn, PART2_DUE_ON, PART3_DUE_ON];

    partsPaise.forEach((amountPaise, i) => {
      instalmentRows.push({
        id: uuidV5("fee-plans", `instalment:${invoice.admissionNo}:${i + 1}`),
        institution_id: ctx.institutionId,
        invoice_id: invoice.invoiceId,
        seq: i + 1,
        due_on: dueDates[i],
        amount: paiseToMoney(amountPaise),
        created_by: principalUserId,
      });
    });
  }
  await insertBatch(ctx.admin, "invoice_instalments", instalmentRows);
}
