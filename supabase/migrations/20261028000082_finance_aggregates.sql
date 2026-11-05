-- DBT-40 fix (M12-T2): money aggregates run in SQL, never by summing a
-- PostgREST select. Root cause confirmed on the seeded demo tenant before
-- this fix (report has the numbers): ledger_entries has ~20.7k rows for
-- that institution and SQL sum(debit) - sum(credit) = 0 (books balanced);
-- `listLedgerEntries`'s old `sumQuery` had no `.range()`, so PostgREST's
-- `max_rows = 1000` (supabase/config.toml) silently truncated it to an
-- unordered 1,000-row slice before the TS code summed it — the "unbalanced"
-- ledger page was a read-path bug, not a double-entry gap. Same cap breaks
-- `termCollectionSummary` once a term has > 1,000 invoices.
--
-- Both functions are `security invoker`: no role check inside — the
-- existing table RLS (ledger_entries = finance_roles() only, 0008/0020;
-- invoices = finance_roles() + owning guardian/student, 0008) already
-- scopes every row, exactly as a normal PostgREST select would. A caller
-- outside those roles gets 0 rows summed to 0, not an error.

create function public.ledger_totals(
  p_institution_id uuid,
  p_from date,
  p_to date,
  p_account text default null
)
returns table (total_debit numeric, total_credit numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(sum(debit), 0) as total_debit,
    coalesce(sum(credit), 0) as total_credit
  from public.ledger_entries
  where institution_id = p_institution_id
    and entry_date >= p_from
    and entry_date <= p_to
    and (p_account is null or account = p_account);
$$;

revoke execute on function public.ledger_totals(uuid, date, date, text) from public, anon;
grant execute on function public.ledger_totals(uuid, date, date, text) to authenticated;
comment on function public.ledger_totals(uuid, date, date, text) is
  'DBT-40 fix: Sigma debit/credit for listLedgerEntries, computed in SQL over every matching row (no PostgREST max_rows truncation). security invoker — RLS on ledger_entries (finance_roles() only) scopes the rows.';

create function public.term_collection_totals(
  p_institution_id uuid,
  p_term_id uuid
)
returns table (invoice_count bigint, due numeric, collected numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) as invoice_count,
    coalesce(sum(total), 0) as due,
    coalesce(sum(paid_total), 0) as collected
  from public.invoices
  where institution_id = p_institution_id
    and term_id = p_term_id;
$$;

revoke execute on function public.term_collection_totals(uuid, uuid) from public, anon;
grant execute on function public.term_collection_totals(uuid, uuid) to authenticated;
comment on function public.term_collection_totals(uuid, uuid) is
  'DBT-40 fix: invoice count + due/collected for termCollectionSummary, computed in SQL over every matching row (no PostgREST max_rows truncation). security invoker — RLS on invoices scopes the rows.';
