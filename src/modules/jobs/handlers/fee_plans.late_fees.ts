// X04-T8 — 06 ruling "Nightly application". Payload: `{ as_of: date }`
// (`enqueue_due_late_fees`, 20261028000087_fee_plans.sql; idempotency key
// `fee_plans.late_fees:<institution_id>:<as_of>` — one job per institution
// per local day). The handler itself never reads `as_of`: `apply_late_fees`
// (X04-T4) recomputes "today" in the institution's own timezone and is
// idempotent, so a retried or late-running job is safe to rerun as-is.
import type { JobHandler } from "../types.ts";

export const lateFees: JobHandler = async (job, { admin }) => {
  if (!job.institution_id) {
    throw new Error("fee_plans.late_fees: job has no institution_id");
  }

  const { error } = await admin.rpc("apply_late_fees", { p_institution_id: job.institution_id });
  // Error text may echo SQL detail (could carry row data) — only the SQL
  // code crosses into `last_error` (CLAUDE.md rule: no PII in thrown errors).
  if (error) throw new Error(`fee_plans.late_fees: ${error.code ?? "unknown"}`);
};
