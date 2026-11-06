// M23-T11 — engine ports: the real IO behind the pure engine's `EnginePorts`
// contract (M23-tasks.md rulings "Ports"). Plain-node safe (the job handler
// and, later, the runner call this): value imports stay relative `.ts`,
// type-only imports may use `@/`. Every thrown error is one of the four
// fixed codes below — never raw SQL text (BRIEF-COMMON lesson 10).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { isModuleEnabled, type ModuleKey } from "../../lib/modules/catalog.ts";
import { createNotification } from "../notifications/service.ts";
import { queueWorkflowAgentRun } from "../agents/queue.ts";
import type { EnginePorts, NodeOutcome } from "./engine.ts";
import type { WorkflowMetricKey } from "./catalog.ts";
import type { AgentConfig, NotifyConfig, ReportConfig } from "./graph.ts";

const MEMBERSHIP_PAGE_SIZE = 500;
const DEFAULT_TZ = "Asia/Kolkata";

export interface EnginePortsRun {
  id: string;
  institution_id: string;
  entity_id: string | null;
}

export interface EnginePortsWorkflow {
  name: string;
  created_by: string;
}

function timezoneOf(settings: Record<string, unknown>): string {
  const locale = (settings.locale ?? null) as { timezone?: unknown } | null;
  const tz = locale?.timezone;
  return typeof tz === "string" && tz.length > 0 ? tz : DEFAULT_TZ;
}

/** `roles` audience: one `workflow_alert` per distinct active member in those roles. */
async function notifyRoles(
  admin: SupabaseClient<Database>,
  run: EnginePortsRun,
  workflow: EnginePortsWorkflow,
  roles: readonly string[],
  message: string,
): Promise<NodeOutcome> {
  const userIds = new Set<string>();
  for (let from = 0; ; from += MEMBERSHIP_PAGE_SIZE) {
    const { data, error } = await admin
      .from("memberships")
      .select("user_id")
      .eq("institution_id", run.institution_id)
      .eq("status", "active")
      .in("role", [...roles])
      .order("id")
      .range(from, from + MEMBERSHIP_PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data ?? []) userIds.add(row.user_id);
    if (!data || data.length < MEMBERSHIP_PAGE_SIZE) break;
  }
  if (userIds.size === 0) return { status: "skipped", note: "No recipients" };

  // shortcut: the ruling's entityId is `${run.id}:${nodeId}`, but the fixed
  // EnginePorts.notify(cfg, message) contract (T8) never passes the node
  // id, so this is `run.id` alone. Every seeded template has at most one
  // `roles` notify node per run, so createNotification's own
  // (type, entityId, recipientUserId) idempotency key still dedupes
  // correctly; upgrade only if a future template adds a second one.
  for (const userId of userIds) {
    await createNotification(admin, {
      institutionId: run.institution_id,
      recipientUserId: userId,
      type: "workflow_alert",
      entityId: run.id,
      vars: { workflow: workflow.name, message },
    });
  }
  return { status: "done", note: `Notified ${userIds.size}` };
}

/** `fee_defaulters` audience: queues M12's `finance.fee_reminder` job for the current term (same key, so a manual send and a workflow send dedupe). */
async function notifyFeeDefaulters(
  admin: SupabaseClient<Database>,
  run: EnginePortsRun,
  settings: Record<string, unknown>,
  now: () => Date,
): Promise<NodeOutcome> {
  const tz = timezoneOf(settings);
  const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now());

  const { data: term, error: termError } = await admin
    .from("terms")
    .select("id")
    .eq("institution_id", run.institution_id)
    .lte("starts_on", asOf)
    .gte("ends_on", asOf)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (termError) throw termError;
  if (!term) return { status: "skipped", note: "No current term" };

  const idempotencyKey = `fee_reminders:${term.id}:${asOf}`; // M12 0074 enqueue_fee_reminders' exact key text
  const { error: upsertError } = await admin.from("jobs").upsert(
    {
      institution_id: run.institution_id,
      type: "finance.fee_reminder",
      payload: { term_id: term.id, as_of: asOf },
      idempotency_key: idempotencyKey,
    },
    { onConflict: "idempotency_key", ignoreDuplicates: true },
  );
  if (upsertError) throw upsertError;
  return { status: "done", note: "Fee reminders queued" };
}

/** Queues M15's `report.generate` job for a scheduled report owned by this institution. */
async function queueReport(
  admin: SupabaseClient<Database>,
  run: EnginePortsRun,
  scheduledReportId: string,
  now: () => Date,
): Promise<NodeOutcome> {
  const { data: schedule, error } = await admin
    .from("scheduled_reports")
    .select("id, status")
    .eq("id", scheduledReportId)
    .eq("institution_id", run.institution_id)
    .maybeSingle();
  if (error) throw error;
  if (!schedule || schedule.status === "paused") return { status: "skipped", note: "Report missing or paused" };

  // shortcut: same nodeId gap as notifyRoles above — key drops `:${nodeId}`
  // (only one `report` node per seeded template today).
  const idempotencyKey = `report.generate:${scheduledReportId}:wf:${run.id}`;
  const { error: upsertError } = await admin.from("jobs").upsert(
    {
      institution_id: run.institution_id,
      type: "report.generate",
      payload: { scheduled_report_id: scheduledReportId, fire_at: now().toISOString() },
      idempotency_key: idempotencyKey,
    },
    { onConflict: "idempotency_key", ignoreDuplicates: true },
  );
  if (upsertError) throw upsertError;
  return { status: "done", note: "Report queued" };
}

/** Builds the `EnginePorts` `runWorkflow` walks for one run (M23-T12's handler calls this once per attempt). */
export function createEnginePorts(
  admin: SupabaseClient<Database>,
  run: EnginePortsRun,
  workflow: EnginePortsWorkflow,
  settings: Record<string, unknown>,
  now: () => Date,
): EnginePorts {
  return {
    moduleOn: (key: ModuleKey) => isModuleEnabled({ institution: { settings } }, key),

    async metric(key: WorkflowMetricKey): Promise<number> {
      const { data, error } = await admin.rpc("workflow_metric", {
        p_institution_id: run.institution_id,
        p_metric: key,
        p_entity_id: run.entity_id as unknown as string, // nullable at runtime; codegen types the RPC arg non-null (same gap as public.record_audit_event)
        p_as_of: now().toISOString(),
      });
      if (error) throw new Error("metric_failed");
      return data as number;
    },

    async notify(cfg: NotifyConfig, message: string): Promise<NodeOutcome> {
      try {
        return cfg.audience === "fee_defaulters"
          ? await notifyFeeDefaulters(admin, run, settings, now)
          : await notifyRoles(admin, run, workflow, cfg.roles, message);
      } catch {
        throw new Error("notify_failed");
      }
    },

    async report(cfg: ReportConfig): Promise<NodeOutcome> {
      try {
        return await queueReport(admin, run, cfg.scheduledReportId, now);
      } catch {
        throw new Error("report_failed");
      }
    },

    async agent(cfg: AgentConfig): Promise<NodeOutcome> {
      try {
        const result = await queueWorkflowAgentRun(admin, {
          institutionId: run.institution_id,
          slug: cfg.agent,
          task: cfg.task,
          requestedBy: workflow.created_by,
          workflowRunId: run.id,
        });
        return result.status === "disabled" ? { status: "skipped", note: "Agent turned off" } : { status: "done", note: "Agent run queued" };
      } catch {
        throw new Error("agent_failed");
      }
    },

    now: () => now().toISOString(),
  };
}
