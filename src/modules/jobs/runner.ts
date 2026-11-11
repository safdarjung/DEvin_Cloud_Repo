import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { redact } from "../../lib/ai/redact.ts";
import { isModuleEnabled } from "../../lib/modules/catalog.ts";
import { JOB_MODULES, resolveHandler } from "./registry.ts";
import type { JobRow } from "./types.ts";

// No `@/` or `server-only` imports above the line this comment sits on:
// `scripts/jobs-run.ts` loads this file with a plain relative import under
// plain Node (no bundler, no path-alias resolution), the same constraint
// documented in `scripts/lib/admin-client.ts`. Only type-only imports (fully
// erased by Node's TypeScript stripping) may use the `@/` alias here —
// `redact` is a value import, so it's pulled in via a relative path too
// (`src/lib/ai/redact.ts` has no imports of its own, so this is safe).

const MAX_LAST_ERROR_LENGTH = 500;

/**
 * Security review fix (T-037, MEDIUM): a handler's thrown message could
 * echo back PII from its input (a phone number, email, etc. in the error
 * text) and `last_error` is shown as-is on the `/jobs` admin page. This is
 * the single place a handler's raw error becomes `last_error` — sanitize
 * here, once, rather than at every call site.
 */
export function sanitizeLastError(message: string): string {
  const { text } = redact(message);
  return text.length > MAX_LAST_ERROR_LENGTH ? `${text.slice(0, MAX_LAST_ERROR_LENGTH)}…` : text;
}

export interface RunOnceOptions {
  /** Wall-clock budget for this invocation (04 §7: 50s per run). */
  budgetMs?: number;
  /** Max jobs claimed in one invocation (04 §7: 50). */
  max?: number;
  workerId: string;
}

export interface RunOnceSummary {
  claimed: number;
  succeeded: number;
  requeued: number;
  dead: number;
}

/** Dispatch found no handler for `job.type` — dead-lettered, never retried. */
export class UnknownJobTypeError extends Error {
  constructor(type: string) {
    super(`unknown_type:${type}`);
  }
}

export interface RunnerPorts {
  claimJob(workerId: string): Promise<JobRow | null>;
  completeJob(id: string, ok: boolean, error?: string | null): Promise<void>;
  killUnknown(id: string, error: string): Promise<void>;
  dispatch(job: JobRow): Promise<void>;
  /** M15-T8: enqueues due `report.generate` jobs (`public.enqueue_due_reports`). */
  enqueueDueReports(): Promise<number>;
  /** X04-T8: enqueues due `fee_plans.late_fees` jobs (`public.enqueue_due_late_fees`). */
  enqueueDueLateFees(): Promise<number>;
  /** M23-T13: enqueues due `workflow.run` jobs (`public.enqueue_due_workflows`). */
  enqueueDueWorkflows(): Promise<number>;
  /** M19-T15: enqueues due `insights.detect` jobs (`public.enqueue_insight_detection`). */
  enqueueDueInsights(): Promise<number>;
  /** M20-T11: enqueues due `mastery.compute` jobs (`public.enqueue_mastery_compute`). */
  enqueueMasteryCompute(): Promise<number>;
  /** M21-T8: enqueues due `forecast.run` jobs (`public.enqueue_due_forecasts`). */
  enqueueDueForecasts(): Promise<void>;
  /** 0138: enqueues the daily `notify.study_reminders` job per institution (`public.enqueue_study_reminders`). */
  enqueueStudyReminders(): Promise<number>;
  /** 0143: deletes orb approval cards past the 30-day retention (`public.purge_ai_proposals`). */
  purgeAiProposals(): Promise<number>;
  now(): number;
}

const DEFAULT_BUDGET_MS = 50_000;
const DEFAULT_MAX = 50;

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toJobRow(raw: Record<string, unknown> | null | undefined): JobRow | null {
  if (!raw || raw.id == null) return null;
  return {
    id: String(raw.id),
    institution_id: raw.institution_id == null ? null : String(raw.institution_id),
    type: String(raw.type),
    payload: (raw.payload ?? {}) as Record<string, unknown>,
    idempotency_key: String(raw.idempotency_key),
    status: raw.status as JobRow["status"],
    attempts: Number(raw.attempts),
    max_attempts: Number(raw.max_attempts),
    run_after: toIso(raw.run_after),
    locked_at: raw.locked_at == null ? null : toIso(raw.locked_at),
    locked_by: raw.locked_by == null ? null : String(raw.locked_by),
    last_error: raw.last_error == null ? null : String(raw.last_error),
    created_at: toIso(raw.created_at),
    updated_at: toIso(raw.updated_at),
  };
}

/**
 * Real ports, built on the service-role `supabase-js` client only — never a
 * direct Postgres connection. `app.claim_job`/`app.complete_job` (0003) live
 * in the `app` schema, which `supabase/config.toml` does not expose over
 * PostgREST, so they're reached through the `public.jobs_claim`/
 * `public.jobs_complete` security-definer wrappers (20261028000012),
 * `execute` granted only to `service_role`. Dead-lettering an unknown type
 * updates `public.jobs` directly: that table is in the exposed `public`
 * schema and `service_role` already has BYPASSRLS plus Supabase's standard
 * table grants, so no wrapper is needed for it.
 */
export function createRunnerPorts(admin: SupabaseClient<Database>): RunnerPorts {
  return {
    async claimJob(workerId) {
      const { data, error } = await admin.rpc("jobs_claim", { p_worker_id: workerId });
      if (error) throw new Error(error.message);
      // The wrapper returns `public.jobs` (a single row, not a set) — the
      // generated type describes the row's shape but not that it can be a
      // SQL NULL when nothing is queued; it can, at runtime (04 §7).
      return toJobRow(data as unknown as Record<string, unknown> | null | undefined);
    },
    async completeJob(id, ok, error) {
      const { error: rpcError } = await admin.rpc("jobs_complete", {
        p_id: id,
        p_ok: ok,
        p_error: error ?? undefined,
      });
      if (rpcError) throw new Error(rpcError.message);
    },
    async killUnknown(id, error) {
      // Direct UPDATE, not `jobs_complete`: an unknown type must never
      // retry (04 §expected changes), but `app.complete_job` always
      // requeues until `max_attempts`. `public.jobs` is not on the
      // immutable-history list (CLAUDE.md rule 5), so updating it directly
      // here is allowed.
      const { error: updateError } = await admin
        .from("jobs")
        .update({ status: "dead", last_error: error, locked_at: null, locked_by: null })
        .eq("id", id);
      if (updateError) throw updateError;
    },
    async dispatch(job) {
      // MOD-T11 (rulings "Jobs") — a job of a module-off institution
      // completes as succeeded with no side effects: dropped, never
      // retried. `Object.hasOwn` (same reasoning as resolveHandler above)
      // so a core job type (no row) is never gated.
      const moduleKey = Object.hasOwn(JOB_MODULES, job.type) ? JOB_MODULES[job.type] : undefined;
      if (moduleKey && job.institution_id) {
        const { data, error } = await admin
          .from("institutions")
          .select("settings")
          .eq("id", job.institution_id)
          .single();
        if (error) throw error;
        if (!isModuleEnabled({ institution: { settings: data.settings as Record<string, unknown> | null } }, moduleKey)) {
          return;
        }
      }

      const handler = resolveHandler(job.type);
      if (!handler) throw new UnknownJobTypeError(job.type);
      await handler(job, { admin });
    },
    async enqueueDueReports() {
      const { data, error } = await admin.rpc("enqueue_due_reports");
      if (error) throw new Error(error.message);
      return Number(data);
    },
    async enqueueDueLateFees() {
      const { data, error } = await admin.rpc("enqueue_due_late_fees");
      if (error) throw new Error(error.message);
      return Number(data);
    },
    async enqueueDueWorkflows() {
      const { data, error } = await admin.rpc("enqueue_due_workflows");
      if (error) throw new Error(error.message);
      return Number(data);
    },
    async enqueueDueInsights() {
      const { data, error } = await admin.rpc("enqueue_insight_detection");
      if (error) throw new Error(error.message);
      return Number(data);
    },
    async enqueueMasteryCompute() {
      const { data, error } = await admin.rpc("enqueue_mastery_compute");
      if (error) throw new Error(error.message);
      return Number(data);
    },
    async enqueueDueForecasts() {
      const { error } = await admin.rpc("enqueue_due_forecasts");
      if (error) throw new Error(error.message);
    },
    async enqueueStudyReminders() {
      const { data, error } = await admin.rpc("enqueue_study_reminders");
      if (error) throw new Error(error.message);
      return Number(data);
    },
    async purgeAiProposals() {
      const { data, error } = await admin.rpc("purge_ai_proposals");
      if (error) throw new Error(error.message);
      return Number(data);
    },
    now: () => Date.now(),
  };
}

/**
 * Runs ONE already-enqueued job inside the request that enqueued it (a fast
 * path for jobs that must not wait for a scheduler, e.g. notify.safety_alert).
 * Same steps as `runOnceCore` — claim, `dispatch` (module gate + handler),
 * `jobs_complete` — so a later runner pass sees it succeeded. The claim is a
 * conditional UPDATE keyed on idempotency key + institution + `queued`, so it
 * never takes a job a runner already holds. It does not use an attempt; on
 * failure or timeout the job goes straight back to `queued` (no backoff) with
 * `last_error` set, and the error is rethrown. The handler keeps running after
 * a timeout, which is safe only because handlers are idempotent (lesson 11).
 * Returns false when there was nothing queued to claim.
 */
export async function runJobNow(
  admin: SupabaseClient<Database>,
  { institutionId, idempotencyKey, timeoutMs }: { institutionId: string; idempotencyKey: string; timeoutMs: number },
): Promise<boolean> {
  const workerId = `inline-${crypto.randomUUID()}`;
  const { data, error } = await admin
    .from("jobs")
    .update({ status: "running", locked_at: new Date().toISOString(), locked_by: workerId })
    .eq("idempotency_key", idempotencyKey)
    .eq("institution_id", institutionId)
    .eq("status", "queued")
    .select()
    .maybeSingle();
  if (error) throw error;
  const job = toJobRow(data);
  if (!job) return false;

  const ports = createRunnerPorts(admin);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ports.dispatch(job),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("in-request budget exceeded")), timeoutMs);
      }),
    ]);
    await ports.completeJob(job.id, true);
    return true;
  } catch (err) {
    const { error: releaseError } = await admin
      .from("jobs")
      .update({
        status: "queued",
        locked_at: null,
        locked_by: null,
        last_error: sanitizeLastError(err instanceof Error ? err.message : "unknown error"),
      })
      .eq("id", job.id)
      .eq("locked_by", workerId)
      .eq("status", "running");
    // Unreleased, the runner's 10-minute stale reclaim still picks it up.
    if (releaseError) console.error(`job ${job.id} release failed`, { code: releaseError.code });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Claims and processes jobs until the budget, the max count, or an empty
 * queue is hit. Never loses a job on a handler exception: every claimed job
 * is completed, dead-lettered, or left for the next run's stale-job reclaim
 * (which `app.claim_job` itself performs) — it is never left silently
 * `running` by this function. C-70/C-71/C-72 (08 §3) are proven in
 * `tests/db/jobs.test.ts` against the real wrappers; this function's own
 * dispatch/backoff/budget logic is proven here against injected ports in
 * `tests/unit/jobs-runner.test.ts`.
 */
export async function runOnceCore(
  { budgetMs = DEFAULT_BUDGET_MS, max = DEFAULT_MAX, workerId }: RunOnceOptions,
  ports: RunnerPorts,
): Promise<RunOnceSummary> {
  const summary: RunOnceSummary = { claimed: 0, succeeded: 0, requeued: 0, dead: 0 };
  const deadline = ports.now() + budgetMs;

  try {
    await ports.enqueueDueReports();
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] report sweep failed`, {
      message: err instanceof Error ? err.message : "unknown error",
    });
  }

  try {
    await ports.enqueueDueLateFees();
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] late-fee sweep failed`, {
      message: err instanceof Error ? err.message : "unknown error",
    });
  }

  try {
    await ports.enqueueMasteryCompute();
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] mastery sweep failed`, {
      message: err instanceof Error ? err.message : "unknown error",
    });
  }

  try {
    await ports.enqueueDueWorkflows();
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] workflows sweep failed`, {
      message: err instanceof Error ? err.message : "unknown error",
    });
  }

  try {
    await ports.enqueueDueInsights();
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] insights sweep failed`, {
      message: err instanceof Error ? err.message : "unknown error",
    });
  }

  try {
    await ports.enqueueDueForecasts();
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] forecast sweep failed`, {
      message: err instanceof Error ? err.message : "unknown error",
    });
  }

  try {
    await ports.enqueueStudyReminders();
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] study reminder sweep failed`, {
      message: err instanceof Error ? err.message : "unknown error",
    });
  }

  try {
    await ports.purgeAiProposals();
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] orb card purge failed`, {
      message: err instanceof Error ? err.message : "unknown error",
    });
  }

  while (summary.claimed < max && ports.now() < deadline) {
    const job = await ports.claimJob(workerId);
    if (!job) break;
    summary.claimed += 1;

    const correlationId = crypto.randomUUID();
    try {
      await ports.dispatch(job);
      await ports.completeJob(job.id, true);
      summary.succeeded += 1;
    } catch (err) {
      if (err instanceof UnknownJobTypeError) {
        await ports.killUnknown(job.id, "unknown_type");
        summary.dead += 1;
        console.error(`[${correlationId}] job ${job.id} has no registered handler`, { type: job.type });
        continue;
      }

      const rawMessage = err instanceof Error ? err.message : "unknown error";
      const message = sanitizeLastError(rawMessage);
      // `job.attempts` was already incremented by the claiming UPDATE inside
      // `app.claim_job`, so this mirrors `app.complete_job`'s own dead-vs-
      // requeue decision without a second round trip. Never log `job.payload`.
      if (job.attempts >= job.max_attempts) {
        summary.dead += 1;
      } else {
        summary.requeued += 1;
      }
      console.error(`[${correlationId}] job ${job.id} (${job.type}) failed`, { message, attempts: job.attempts });
      await ports.completeJob(job.id, false, message);
    }
  }

  return summary;
}
