-- 0112 (DBT-159) — SQL aggregates over ai_usage_events. PostgREST caps selects
-- at max_rows 1000, so JS-side sums were wrong past 1000 events. All three are
-- security invoker: the caller's own RLS applies (service_role bypasses it, as
-- before for checkLimits). Not definers, so no 07 §4 row.

create function public.ai_usage_sum(
  p_institution_id uuid,
  p_from timestamptz,
  p_role text default null,
  p_user_id uuid default null,
  p_feature text default null
)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(input_tokens::bigint + output_tokens), 0)::bigint
  from public.ai_usage_events
  where institution_id = p_institution_id
    and created_at >= p_from
    and (p_role is null or role = p_role)
    and (p_user_id is null or user_id = p_user_id)
    and (p_feature is null or feature = p_feature);
$$;

create function public.ai_usage_by_provider(p_institution_id uuid, p_from timestamptz, p_to timestamptz)
returns table (provider text, requests bigint, ok_requests bigint, input_tokens bigint, output_tokens bigint, cost_usd numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.provider,
         count(*),
         count(*) filter (where e.ok),
         coalesce(sum(e.input_tokens::bigint), 0)::bigint,
         coalesce(sum(e.output_tokens::bigint), 0)::bigint,
         coalesce(sum(e.cost_estimate_usd), 0)
  from public.ai_usage_events e
  where e.institution_id = p_institution_id
    and e.created_at >= p_from
    and e.created_at <= p_to
  group by e.provider;
$$;

create function public.ai_usage_tokens_by_role(p_institution_id uuid, p_from timestamptz)
returns table (role text, tokens bigint, cost_usd numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(e.role, 'unknown'),
         coalesce(sum(e.input_tokens::bigint + e.output_tokens), 0)::bigint,
         coalesce(sum(e.cost_estimate_usd), 0)
  from public.ai_usage_events e
  where e.institution_id = p_institution_id
    and e.created_at >= p_from
  group by coalesce(e.role, 'unknown');
$$;

revoke execute on function public.ai_usage_sum(uuid, timestamptz, text, uuid, text) from public, anon;
revoke execute on function public.ai_usage_by_provider(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.ai_usage_tokens_by_role(uuid, timestamptz) from public, anon;
grant execute on function public.ai_usage_sum(uuid, timestamptz, text, uuid, text) to authenticated, service_role;
grant execute on function public.ai_usage_by_provider(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.ai_usage_tokens_by_role(uuid, timestamptz) to authenticated, service_role;
