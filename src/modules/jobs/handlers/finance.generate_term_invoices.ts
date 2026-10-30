// T-031 — 06 §W9: generate every active student's Term invoice for an
// institution. Payload: `{ term_id: uuid, grade_id?: uuid | null }`
// (`generateTermInvoices`'s packet key `invoices:<term_id>:<grade_id|all>`
// is the idempotency key a future enqueue wrapper should pass — nothing
// enqueues this job type yet, see src/modules/finance/actions.ts and the
// completion report). Scoped to `job.institution_id` only — the payload is
// never trusted for tenant scope (CLAUDE.md rule 1/2).
//
// Idempotent: `public.generate_invoice` is idempotent per (student, term),
// so reprocessing a student who already has a Term invoice is a no-op —
// a rerun or a retry after a mid-batch failure creates no duplicates.
// Batching (08 §risk: ~3,024 students may exceed the 50s job budget):
// this handler stops before its own soft budget and throws so the runner's
// normal retry/backoff resumes the remaining students next attempt —
// generate_invoice's own idempotency makes that resumption safe without a
// second enqueue call (which isn't reachable from here either: `app.
// enqueue_job` lives in the `app` schema, not PostgREST-exposed).
import { z } from "zod";
import type { JobHandler } from "../types.ts";

const PayloadSchema = z
  .object({
    term_id: z.string().uuid(),
    grade_id: z.string().uuid().nullable().optional(),
  })
  .strict();

const SOFT_BUDGET_MS = 40_000;

export const generateTermInvoices: JobHandler = async (job, { admin }) => {
  if (!job.institution_id) {
    throw new Error("finance.generate_term_invoices: job has no institution_id");
  }

  const parsed = PayloadSchema.safeParse(job.payload);
  if (!parsed.success) {
    // No PII in the error — never echo the raw payload.
    throw new Error("finance.generate_term_invoices: invalid payload");
  }
  const { term_id: termId, grade_id: gradeId } = parsed.data;

  const { data: term, error: termError } = await admin
    .from("terms")
    .select("id, academic_year_id")
    .eq("id", termId)
    .eq("institution_id", job.institution_id)
    .maybeSingle();
  if (termError) throw termError;
  if (!term) throw new Error("finance.generate_term_invoices: term not found for this institution");

  if (gradeId) {
    const { data: grade, error: gradeError } = await admin
      .from("grades")
      .select("id")
      .eq("id", gradeId)
      .eq("institution_id", job.institution_id)
      .maybeSingle();
    if (gradeError) throw gradeError;
    if (!grade) throw new Error("finance.generate_term_invoices: grade not found for this institution");
  }

  // T-043 load-test finding: PostgREST defaults to a 1,000-row page. Without
  // `.range()`, a term with >1,000 active enrolments (3,024 in the seeded
  // demo tenant) silently got invoices for only the first 1,000 students —
  // the job still reported `succeeded`, no error, no `outOfBudget`. Paged
  // explicitly here; the per-page cap is PostgREST's own, not a magic
  // number chosen for this fix.
  const PAGE_SIZE = 1000;
  const enrolments: Array<{ student_id: string }> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let enrolmentQuery = admin
      .from("enrolments")
      .select("student_id, class_sections!inner(grade_id)")
      .eq("institution_id", job.institution_id)
      .eq("academic_year_id", term.academic_year_id)
      .eq("status", "active")
      .order("id") // stable order, or pages can skip/repeat rows
      .range(from, from + PAGE_SIZE - 1);
    if (gradeId) {
      enrolmentQuery = enrolmentQuery.eq("class_sections.grade_id", gradeId);
    }
    const { data: page, error: enrolError } = await enrolmentQuery;
    if (enrolError) throw enrolError;
    enrolments.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }

  const studentIds = Array.from(new Set(enrolments.map((e) => e.student_id)));

  const deadline = Date.now() + SOFT_BUDGET_MS;
  let processed = 0;
  let failedCount = 0;
  let outOfBudget = false;

  for (const studentId of studentIds) {
    if (Date.now() >= deadline) {
      outOfBudget = true;
      break;
    }
    const { error } = await admin.rpc("generate_invoice", { p_student_id: studentId, p_term_id: termId });
    if (error) {
      // Log only ids — never the SQL error's `detail` text, which may
      // echo back validation context; a studentId/term pair is not PII.
      console.error("finance.generate_term_invoices: generate_invoice failed", {
        jobId: job.id,
        termId,
        failed: true,
      });
      failedCount += 1;
      continue;
    }
    processed += 1;
  }

  if (outOfBudget || failedCount > 0) {
    // Throwing lets the runner's normal backoff/retry continue the
    // remaining students next attempt (generate_invoice's idempotency
    // means already-processed students are skipped, not duplicated).
    throw new Error(
      `finance.generate_term_invoices: processed ${processed}/${studentIds.length} students (${failedCount} failed, budget exceeded: ${outOfBudget})`,
    );
  }
};
