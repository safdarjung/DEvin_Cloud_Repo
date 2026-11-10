import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

export interface UsageSummaryRange {
  from: Date;
  to?: Date;
}

export interface ProviderUsageSummary {
  requests: number;
  okRequests: number;
  inputTokens: number;
  outputTokens: number;
  costEstimateUsd: number;
}

export interface UsageSummary {
  rangeFrom: string;
  rangeTo: string;
  totalRequests: number;
  totalTokens: number;
  totalCostEstimateUsd: number;
  byProvider: Record<"local" | "cloud", ProviderUsageSummary>;
}

const DEFAULT_RANGE_DAYS = 30;

function emptyProviderSummary(): ProviderUsageSummary {
  return { requests: 0, okRequests: 0, inputTokens: 0, outputTokens: 0, costEstimateUsd: 0 };
}

/**
 * 07 §5 "Transparency" — the admin-facing usage/cost summary for `/ai/usage`.
 * `ai.usage.read` is granted only to owner/principal/admin, exactly the
 * roles the `ai_usage_events_select` RLS policy allows, so the ordinary
 * user-scoped client is sufficient here (no service role).
 */
export async function usageSummary(ctx: TenantContext, range?: UsageSummaryRange): Promise<UsageSummary> {
  const from = range?.from ?? new Date(Date.now() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  const to = range?.to ?? new Date();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_usage_by_provider", {
    p_institution_id: ctx.institution.id,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });

  if (error) throw error;

  const byProvider: UsageSummary["byProvider"] = { local: emptyProviderSummary(), cloud: emptyProviderSummary() };
  let totalRequests = 0;
  let totalTokens = 0;
  let totalCostEstimateUsd = 0;

  for (const row of data ?? []) {
    const bucket = row.provider === "cloud" ? byProvider.cloud : byProvider.local;
    bucket.requests += Number(row.requests);
    bucket.okRequests += Number(row.ok_requests);
    bucket.inputTokens += Number(row.input_tokens);
    bucket.outputTokens += Number(row.output_tokens);
    bucket.costEstimateUsd += Number(row.cost_usd);
    totalRequests += Number(row.requests);
    totalTokens += Number(row.input_tokens) + Number(row.output_tokens);
    totalCostEstimateUsd += Number(row.cost_usd);
  }

  return {
    rangeFrom: from.toISOString(),
    rangeTo: to.toISOString(),
    totalRequests,
    totalTokens,
    totalCostEstimateUsd,
    byProvider,
  };
}

export interface UsageByRole {
  role: string;
  tokens: number;
  cost_paise: number;
}

// shortcut: fixed ₹84/USD estimate, same constant as
// modules/agents/queries.ts's cost_paise_30d — upgrade both together if a
// settings-driven rate ever lands.
const USD_TO_PAISE = 8_400;

/**
 * T3b (ai-roles) — 30-day tokens/cost per membership role, for the AI role
 * settings page. Same RLS-only read as usageSummary (`ai.usage.read` is
 * owner/principal/admin, exactly `ai_usage_events_select`'s allow-list).
 * Rows logged before migration 0108 have `role = null`; those are grouped
 * under "unknown" rather than dropped.
 */
export async function usageByRole(ctx: TenantContext): Promise<UsageByRole[]> {
  const from = new Date(Date.now() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_usage_tokens_by_role", {
    p_institution_id: ctx.institution.id,
    p_from: from.toISOString(),
  });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    role: row.role,
    tokens: Number(row.tokens),
    cost_paise: Math.round(Number(row.cost_usd) * USD_TO_PAISE),
  }));
}
