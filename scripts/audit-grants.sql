-- T-042 grants audit (07 §4). Lists every function in the `app` and `public`
-- schemas with its security mode, pinned search_path and who may EXECUTE it.
-- Run: node -e or psql "$SUPABASE_DB_URL" -f scripts/audit-grants.sql
-- Asserted by tests/security/grants.test.ts.
select
  n.nspname as schema,
  p.proname as name,
  case when p.prosecdef then 'definer' else 'invoker' end as security,
  p.prorettype = 'trigger'::regtype as is_trigger,
  coalesce((select c from unnest(p.proconfig) c where c like 'search_path=%'), '') as search_path,
  has_function_privilege('anon', p.oid, 'execute') as anon,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
  has_function_privilege('service_role', p.oid, 'execute') as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('app', 'public')
  and p.prokind = 'f'
order by n.nspname, p.proname;
