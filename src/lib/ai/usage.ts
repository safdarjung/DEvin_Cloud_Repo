import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_INSTITUTION_SETTINGS, InstitutionSettingsSchema } from "@/modules/core/schemas";
import type { TenantContext } from "@/lib/auth/types";
import type { ProviderStep } from "@/lib/ai/policy";

type AiSettings = typeof DEFAULT_INSTITUTION_SETTINGS.ai;

export function aiSettingsFor(ctx: TenantContext): AiSettings {
  const raw = (ctx.institution.settings as { ai?: unknown }).ai;
  const parsed = InstitutionSettingsSchema.shape.ai.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_INSTITUTION_SETTINGS.ai;
}

function timezoneFor(ctx: TenantContext): string {
  const settings = ctx.institution.settings as { locale?: { timezone?: unknown } };
  const raw = settings.locale?.timezone;
  return typeof raw === "string" && raw.length > 0 ? raw : DEFAULT_INSTITUTION_SETTINGS.locale.timezone;
}

// 07 §4 allow-list: `ai_usage_events` has no INSERT policy, and its SELECT
// policy excludes teachers who nonetheless hold `ai.generate` — the gateway
// reads/writes usage metadata (never prompt text) via the service role.
// The caller is set only for the synchronous factory call and then restored:
// leaving it set would unlock createAdminClient() for the whole server process.
export function withAiServiceRole<T>(fn: () => T): T {
  const previous = process.env.SERVICE_ROLE_CALLER;
  process.env.SERVICE_ROLE_CALLER = "ai";
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.SERVICE_ROLE_CALLER;
    else process.env.SERVICE_ROLE_CALLER = previous;
  }
}

function timezoneOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const { type, value } of dtf.formatToParts(date)) parts[type] = value;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** Midnight in `timeZone`, as a UTC instant — 06 §W10 "today in the institution timezone". */
export function startOfDayInTimezone(timeZone: string, now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const candidateUtc = new Date(`${ymd}T00:00:00Z`);
  return new Date(candidateUtc.getTime() - timezoneOffsetMs(timeZone, candidateUtc));
}

export type LimitsResult = { ok: true } | { ok: false; code: "quota_exceeded" | "rate_limited" };

/**
 * 06 §W10 order: daily token quota, then per-user per-minute rate. `feature`
 * is accepted (and logged by the caller) for a future per-feature quota;
 * today's limits are institution/user-wide, matching `settings.ai` (05 §4.1).
 */
// GU-08 security review (H1): without this, one student chatting can
// exhaust `daily_token_quota` (institution-wide) and lock teachers out of
// local AI for the rest of the day. Checked in addition to, never instead
// of, the institution-wide quota above.
const STUDENT_QUOTA_FEATURES = new Set(["student_study", "practice_quiz"]);

export async function checkLimits(ctx: TenantContext, feature: string): Promise<LimitsResult> {
  const settings = aiSettingsFor(ctx);
  const admin = withAiServiceRole(() => createAdminClient());

  const dayStart = startOfDayInTimezone(timezoneFor(ctx));
  const { data: dayRows, error: dayError } = await admin
    .from("ai_usage_events")
    .select("input_tokens, output_tokens")
    .eq("institution_id", ctx.institution.id)
    .gte("created_at", dayStart.toISOString());
  if (dayError) throw dayError;

  const tokensToday = (dayRows ?? []).reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0);
  if (tokensToday >= settings.daily_token_quota) {
    return { ok: false, code: "quota_exceeded" };
  }

  if (STUDENT_QUOTA_FEATURES.has(feature)) {
    const { data: studentRows, error: studentError } = await admin
      .from("ai_usage_events")
      .select("input_tokens, output_tokens")
      .eq("institution_id", ctx.institution.id)
      .eq("user_id", ctx.user.id)
      .eq("feature", feature)
      .gte("created_at", dayStart.toISOString());
    if (studentError) throw studentError;

    const studentTokensToday = (studentRows ?? []).reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0);
    if (studentTokensToday >= settings.student_daily_token_quota) {
      return { ok: false, code: "quota_exceeded" };
    }
  }

  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count, error: rateError } = await admin
    .from("ai_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", ctx.user.id)
    .gte("created_at", oneMinuteAgo);
  if (rateError) throw rateError;

  if ((count ?? 0) >= settings.per_user_per_minute) {
    return { ok: false, code: "rate_limited" };
  }

  return { ok: true };
}

export interface UsageEvent {
  ctx: TenantContext;
  feature: string;
  provider: ProviderStep;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costEstimateUsd: number;
  ok: boolean;
  errorCode: string | null;
  redactions: number;
  agentRunId?: string | null;
}

/**
 * Metadata-only insert (07 §5, §7): never the prompt or output text. Never
 * throws — a logging failure must not fail the AI response the caller is
 * waiting on; it is reported via console.error with a correlation id.
 */
export async function logUsage(event: UsageEvent): Promise<void> {
  try {
    const admin = withAiServiceRole(() => createAdminClient());
    const { error } = await admin.from("ai_usage_events").insert({
      institution_id: event.ctx.institution.id,
      user_id: event.ctx.user.id,
      feature: event.feature,
      provider: event.provider,
      model: event.model,
      input_tokens: event.inputTokens,
      output_tokens: event.outputTokens,
      latency_ms: event.latencyMs,
      cost_estimate_usd: event.costEstimateUsd,
      ok: event.ok,
      error_code: event.errorCode,
      redactions: event.redactions,
      agent_run_id: event.agentRunId ?? null,
    });
    if (error) throw error;
  } catch (err) {
    const correlationId = crypto.randomUUID();
    console.error(`[${correlationId}] failed to log ai_usage_events`, err);
  }
}

// DBT-02: per-process semaphore, not a DB-wide lock — documented limitation
// on serverless (multiple instances each get their own counter); the daily
// token quota above is the hard limit.
const inFlight = new Map<string, number>();

export function acquireConcurrencySlot(institutionId: string, step: ProviderStep, limit: number): boolean {
  const key = `${institutionId}:${step}`;
  const current = inFlight.get(key) ?? 0;
  if (current >= limit) return false;
  inFlight.set(key, current + 1);
  return true;
}

export function releaseConcurrencySlot(institutionId: string, step: ProviderStep): void {
  const key = `${institutionId}:${step}`;
  inFlight.set(key, Math.max(0, (inFlight.get(key) ?? 0) - 1));
}
