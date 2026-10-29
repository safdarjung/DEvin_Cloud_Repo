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
  const { data, error } = await supabase
    .from("ai_usage_events")
    .select("provider, input_tokens, output_tokens, cost_estimate_usd, ok")
    .eq("institution_id", ctx.institution.id)
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString());

  if (error) throw error;

  const byProvider: UsageSummary["byProvider"] = { local: emptyProviderSummary(), cloud: emptyProviderSummary() };
  let totalTokens = 0;
  let totalCostEstimateUsd = 0;

  for (const row of data ?? []) {
    const bucket = row.provider === "cloud" ? byProvider.cloud : byProvider.local;
    bucket.requests += 1;
    if (row.ok) bucket.okRequests += 1;
    bucket.inputTokens += row.input_tokens;
    bucket.outputTokens += row.output_tokens;
    bucket.costEstimateUsd += row.cost_estimate_usd;
    totalTokens += row.input_tokens + row.output_tokens;
    totalCostEstimateUsd += row.cost_estimate_usd;
  }

  return {
    rangeFrom: from.toISOString(),
    rangeTo: to.toISOString(),
    totalRequests: (data ?? []).length,
    totalTokens,
    totalCostEstimateUsd,
    byProvider,
  };
}
