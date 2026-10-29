import postgres from "postgres";
import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { GRADES, sectionKey, sectionNames } from "../lib/grades.ts";
import { uuidV5 } from "../lib/ids.ts";

// 05 §8 / §8.1 (INV-T2-Aarav) / §2.6 — one fee structure per grade, every
// active enrolment assigned, ~8% concessions, Term 1 + Term 2 invoices via
// app.generate_invoice, ~70% of invoice value collected via
// app.record_payment. `app` is not PostgREST-exposed, so both functions are
// called over a direct Postgres connection (same pattern as people.ts's
// app.next_sequence calls) — never via direct table writes, so sequence
// allocation, invoice_lines, and ledger entries all come from the same
// single code path production uses (06 §W9).
//
// Deviation from the packet's literal "12 structures" (recorded in the
// completion report): the schema has no per-student override of which fee
// components apply, and a fee_assignment points at exactly one structure.
// Modelling "transport assigned to ~40% of students" therefore needs two
// structure variants per grade (with/without the transport component) —
// 24 structures, not 12. Every other stated count (3,024 assignments,
// 6,048 invoices, receipts = payments) is unaffected by this.

const TUITION_BY_GRADE: Record<string, number> = {
  I: 2200, II: 2200, III: 2200, IV: 2200, V: 2200,
  VI: 2600, VII: 2600, VIII: 2600,
  IX: 3000, X: 3000,
  XI: 3400, XII: 3400,
};

const ANNUAL_CHARGES = 6000;
const EXAM_FEE = 500;
const LAB_COMPUTER_FEE = 600;
const ACTIVITY_FEE = 1200;
const TRANSPORT_FEE = 1500;
const LAB_COMPUTER_FROM_SORT_KEY = 6; // Grade VI onward (GRADES is sorted I..XII, sortKey 1..12)

const CONCESSION_KINDS = ["sibling", "staff_ward", "ews_rte"] as const;

interface FeeComponentDef {
  head: string;
  amount: number;
  frequency: "annual" | "term" | "monthly";
}

function componentsFor(gradeCode: string, sortKey: number, withTransport: boolean): FeeComponentDef[] {
  const components: FeeComponentDef[] = [
    { head: "tuition", amount: TUITION_BY_GRADE[gradeCode]!, frequency: "monthly" },
    { head: "annual_charges", amount: ANNUAL_CHARGES, frequency: "annual" },
    { head: "exam", amount: EXAM_FEE, frequency: "term" },
    { head: "activity", amount: ACTIVITY_FEE, frequency: "annual" },
  ];
  if (sortKey >= LAB_COMPUTER_FROM_SORT_KEY) {
    components.push({ head: "lab_computer", amount: LAB_COMPUTER_FEE, frequency: "term" });
  }
  if (withTransport) {
    components.push({ head: "transport", amount: TRANSPORT_FEE, frequency: "monthly" });
  }
  return components;
}

async function runConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function run(ctx: SeedContext): Promise<void> {
  const { data: existing } = await ctx.admin
    .from("fee_structures")
    .select("id")
    .eq("institution_id", ctx.institutionId)
    .limit(1)
    .maybeSingle();
  if (existing) return; // idempotent rerun guard

  // ---- fee_structures + fee_components (2 variants per grade, see header) ----
  const structureRows: Record<string, unknown>[] = [];
  const componentRows: Record<string, unknown>[] = [];
  const structureIdByGradeAndTransport = new Map<string, string>(); // `${gradeCode}:${withTransport}` -> structure id
  const headsByStructureId = new Map<string, string[]>();

  for (const grade of GRADES) {
    for (const withTransport of [false, true]) {
      const name = `${grade.displayName} ${withTransport ? "with Transport" : "Standard"}`;
      const structureId = uuidV5("finance", `structure:${grade.code}:${withTransport}`);
      structureIdByGradeAndTransport.set(`${grade.code}:${withTransport}`, structureId);
      structureRows.push({
        id: structureId,
        institution_id: ctx.institutionId,
        academic_year_id: ctx.academicYearId,
        grade_id: uuidV5("academics", `grade:${grade.code}`),
        name,
        is_default: !withTransport,
      });

      const components = componentsFor(grade.code, grade.sortKey, withTransport);
      headsByStructureId.set(structureId, components.map((c) => c.head));
      for (const component of components) {
        componentRows.push({
          id: uuidV5("finance", `component:${grade.code}:${withTransport}:${component.head}`),
          institution_id: ctx.institutionId,
          fee_structure_id: structureId,
          head: component.head,
          amount: component.amount,
          frequency: component.frequency,
        });
      }
    }
  }

  await insertBatch(ctx.admin, "fee_structures", structureRows);
  await insertBatch(ctx.admin, "fee_components", componentRows);

  // ---- fee_assignments (every active enrolment) + concessions (~8%) ----
  const assignmentRows: Record<string, unknown>[] = [];
  const concessionRows: Record<string, unknown>[] = [];
  const principalUserId = ctx.userIdByLogin["principal"];

  let concessionCursor = 0;
  for (const grade of GRADES) {
    for (const sectionName of sectionNames(grade.code)) {
      const key = sectionKey(grade.code, sectionName);
      for (const student of ctx.studentsBySection[key] ?? []) {
        const withTransport = ctx.rng() < 0.4;
        const structureId = structureIdByGradeAndTransport.get(`${grade.code}:${withTransport}`)!;
        const assignmentId = uuidV5("finance", `assignment:${student.id}`);
        assignmentRows.push({
          id: assignmentId,
          institution_id: ctx.institutionId,
          student_id: student.id,
          fee_structure_id: structureId,
          academic_year_id: ctx.academicYearId,
        });

        if (ctx.rng() < 0.08) {
          const kind = CONCESSION_KINDS[concessionCursor % CONCESSION_KINDS.length]!;
          concessionCursor += 1;
          if (kind === "ews_rte") {
            // 100% waiver on every head (05 §8.1). 20261028000024 fixed
            // app.generate_invoice to skip the degenerate (debit 0, credit 0)
            // fees_receivable ledger_entries row on a net-zero invoice
            // instead of inserting it — the check constraint no longer
            // rejects a literal full waiver.
            for (const head of headsByStructureId.get(structureId) ?? []) {
              concessionRows.push({
                id: uuidV5("finance", `concession:${student.id}:ews_rte:${head}`),
                institution_id: ctx.institutionId,
                fee_assignment_id: assignmentId,
                kind,
                head,
                percent: 100,
                approved_by: principalUserId,
                reason: "EWS/RTE admission — full fee waiver per institution policy.",
              });
            }
          } else {
            concessionRows.push({
              id: uuidV5("finance", `concession:${student.id}:${kind}`),
              institution_id: ctx.institutionId,
              fee_assignment_id: assignmentId,
              kind,
              head: "tuition",
              percent: kind === "sibling" ? 15 : 50,
              approved_by: principalUserId,
              reason: kind === "sibling" ? "Sibling discount on tuition." : "Staff ward discount on tuition.",
            });
          }
        }
      }
    }
  }

  await insertBatch(ctx.admin, "fee_assignments", assignmentRows);
  await insertBatch(ctx.admin, "concessions", concessionRows);

  // ---- invoices (app.generate_invoice) + payments (app.record_payment) ----
  // Own connection pool (not ctx.sql, which index.ts caps at max:1) so the
  // ~6,048 generate_invoice/record_payment RPCs — `app` is never
  // PostgREST-exposed, so these can't go through ctx.admin — run with real
  // concurrency instead of one at a time.
  const financeSql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });
  try {
    const students: { id: string; firstName: string }[] = [];
    for (const grade of GRADES) {
      for (const sectionName of sectionNames(grade.code)) {
        students.push(...(ctx.studentsBySection[sectionKey(grade.code, sectionName)] ?? []));
      }
    }

    const aarav = (ctx.studentsBySection["VI-A"] ?? []).find((s) => s.firstName === "Aarav");
    const ananya = (ctx.studentsBySection["X-A"] ?? []).find((s) => s.firstName === "Ananya");
    const ishaan = (ctx.studentsBySection["VIII-B"] ?? []).find((s) => s.firstName === "Ishaan");

    function pickMode(r: number): string {
      if (r < 0.5) return "cash";
      if (r < 0.85) return "upi";
      if (r < 0.95) return "neft";
      return "cheque";
    }

    interface PaymentPlan {
      studentId: string;
      outcome: "unpaid" | "full" | "half";
      mode: string;
      receivedAt: string;
    }

    // All rng()-consuming decisions happen here, synchronously, in a fixed
    // per-student order — determinism requires the random draws to happen
    // in the same sequence every run. The concurrent I/O phase below reads
    // this plan only; it makes zero rng() calls, so network timing (which
    // DB round trip finishes first) can never change what gets written.
    function buildPlan(termStartsOn: string, isTerm2: boolean): Map<string, PaymentPlan> {
      const plan = new Map<string, PaymentPlan>();
      for (const student of students) {
        let outcome: "unpaid" | "full" | "half";
        // 05 §8.1: Aarav's Term 2 invoice stays unpaid (recorded live);
        // Ananya's and Ishaan's Term 2 invoices are paid in full. For Term
        // 1 (not individually named in §8.1), Aarav/Ananya instead satisfy
        // T-033 AC4 ("one paid, one part-paid") deterministically.
        if (isTerm2 && student.id === aarav?.id) {
          outcome = "unpaid";
        } else if (isTerm2 && (student.id === ananya?.id || student.id === ishaan?.id)) {
          outcome = "full";
        } else if (!isTerm2 && student.id === aarav?.id) {
          outcome = "full";
        } else if (!isTerm2 && student.id === ananya?.id) {
          outcome = "half";
        } else {
          // Term 2 payers skew toward paying in full (80/20) rather than a
          // flat 50/50 full/half split — needed so the blended Term 1 +
          // Term 2 collection rate lands on the packet's ≈70% target given
          // Term 1's larger per-invoice total (it alone carries the annual
          // components) and lower (85% vs 55%) pay rate.
          const payThreshold = isTerm2 ? 0.55 : 0.85;
          outcome = ctx.rng() >= payThreshold ? "unpaid" : isTerm2 && ctx.rng() < 0.2 ? "half" : "full";
        }

        const mode = pickMode(ctx.rng());
        const offsetDays = Math.floor(ctx.rng() * (isTerm2 ? 20 : 150));
        plan.set(student.id, { studentId: student.id, outcome, mode, receivedAt: `${addDays(termStartsOn, offsetDays)}T11:00:00+05:30` });
      }
      return plan;
    }

    async function generateAndPay(termId: string, termStartsOn: string, isTerm2: boolean) {
      const plan = buildPlan(termStartsOn, isTerm2);
      await runConcurrent(students, 10, async (student) => {
        const [invRow] = await financeSql`select app.generate_invoice(${student.id}::uuid, ${termId}::uuid) as id`;
        const invoiceId = invRow!.id as string;
        const entry = plan.get(student.id)!;
        if (entry.outcome === "unpaid") return;

        const [invoice] = await financeSql`select invoice_no, total from public.invoices where id = ${invoiceId}`;
        const invoiceNo = invoice!.invoice_no as string;
        const total = Number(invoice!.total);
        // A 100%-ews_rte invoice has total 0 and is already 'paid' by
        // app.generate_invoice itself — nothing to record, and
        // app.record_payment rejects amount <= 0 ("amount must be greater
        // than zero").
        if (total <= 0) return;
        const amount = entry.outcome === "half" ? Math.round((total / 2) * 100) / 100 : total;

        await financeSql`
          select app.record_payment(
            ${invoiceId}::uuid, ${amount}::numeric, ${entry.mode}, null, ${entry.receivedAt}::timestamptz,
            ${`seed:pay:${invoiceNo}:1`}
          )
        `;
      });
    }

    await generateAndPay(ctx.termIds.term1, "2026-04-01", false);
    await generateAndPay(ctx.termIds.term2, "2026-10-01", true);
  } finally {
    await financeSql.end();
  }
}
