import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

// 06 §7 job types. Adding one here requires a matching entry in
// `registry.ts` (unknown types dead-letter immediately, no retry).
export type JobType =
  | "notify.attendance_absence"
  | "notify.results_published"
  | "notify.recheck_decided"
  | "notify.enquiry_received"
  | "notify.enrolment_welcome"
  | "notify.announcement"
  | "notify.gate_pass"
  | "finance.generate_term_invoices"
  | "report.generate"
  | "finance.fee_reminder"
  | "forecast.run";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

// Mirrors `public.jobs` (supabase/migrations/20261028000003_platform.sql).
export interface JobRow {
  id: string;
  institution_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobHandlerDeps {
  /** Service-role client (07 §4) — never exposed to handlers any other way. */
  admin: SupabaseClient<Database>;
}

/**
 * A job handler must be idempotent: the runner retries on any throw with
 * backoff (06 §W12), and a stale `running` job (>10 min — e.g. a crashed
 * worker) is reclaimed by `app.claim_job` and may run again. Upsert on
 * natural keys; never assume exactly-once execution. Never log `job.payload`
 * (may hold PII) — log only `job.id`/`job.type` and a correlation id.
 */
export type JobHandler = (job: JobRow, deps: JobHandlerDeps) => Promise<void>;
