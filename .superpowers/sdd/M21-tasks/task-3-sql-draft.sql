-- ---------------------------------------------------------------------------
-- M21-T3: series sources + sweep (0094 part 2, same file, unmerged — see
-- part 1's header). Rulings "Series sources", "Scheduling". Both series
-- functions are `security invoker`: only the forecast.run job (service
-- role) ever calls them, so the explicit p_institution_id filters are the
-- real scope, not RLS (lesson 7 — no per-row definer calls needed here
-- either, these are table scans, not RLS policies).
-- ---------------------------------------------------------------------------

-- app.assert_forecast_window — plpgsql helper so the pure-SQL
-- forecast_attendance_series below can still raise 'code:validation_failed'
-- (plain `language sql` functions have no RAISE; calling this as a leading
-- statement, whose result is discarded, gives the same effect). Internal
-- only: granted to service_role alongside the function that calls it.
create function app.assert_forecast_window(p_from date, p_to date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_to <= p_from or (p_to - p_from) > 400 then
    raise exception 'code:validation_failed' using detail = 'attendance window must be positive and at most 400 days';
  end if;
end;
$$;

revoke execute on function app.assert_forecast_window(date, date) from public, anon, authenticated;
grant execute on function app.assert_forecast_window(date, date) to service_role;

-- public.forecast_fee_series — every term of the institution, contiguous
-- windows (window_end = next term's starts_on; last term = ends_on + 1, so
-- a payment in the "gap" between two terms still lands in the earlier
-- one). collected_paise excludes any payment with a payment_reversals row
-- (M12, 0074); billed_paise excludes cancelled invoices. Both rounded to
-- exact integer paise.
create function public.forecast_fee_series(p_institution_id uuid)
returns table (
  term_id uuid,
  sequence int,
  name text,
  starts_on date,
  window_end date,
  collected_paise bigint,
  billed_paise bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with term_windows as (
    select
      t.id as term_id,
      t.sequence,
      t.name,
      t.starts_on,
      coalesce(lead(t.starts_on) over (order by t.starts_on), t.ends_on + 1) as window_end,
      coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') as tz
    from public.terms t
    join public.institutions i on i.id = t.institution_id
    where t.institution_id = p_institution_id
  )
  select
    tw.term_id,
    tw.sequence,
    tw.name,
    tw.starts_on,
    tw.window_end,
    coalesce((
      select round(sum(p.amount) * 100)::bigint
      from public.payments p
      where p.institution_id = p_institution_id
        and (p.received_at at time zone tw.tz)::date >= tw.starts_on
        and (p.received_at at time zone tw.tz)::date < tw.window_end
        and not exists (select 1 from public.payment_reversals pr where pr.payment_id = p.id)
    ), 0) as collected_paise,
    coalesce((
      select round(sum(inv.total) * 100)::bigint
      from public.invoices inv
      where inv.institution_id = p_institution_id
        and inv.term_id = tw.term_id
        and inv.status <> 'cancelled'
    ), 0) as billed_paise
  from term_windows tw
  order by tw.starts_on;
$$;

revoke execute on function public.forecast_fee_series(uuid) from public, anon, authenticated;
grant execute on function public.forecast_fee_series(uuid) to service_role;

-- public.forecast_attendance_series — daily sessions only (period_id is
-- null), submitted status, weighted exactly like 0009's
-- app.term_attendance_percentage (counts_present/in_denominator from
-- settings.attendance.statuses). One row per section with denominator > 0
-- weeks, plus one school-wide row (class_section_id null, sums across
-- sections); weeks with 0 denominator are dropped at both levels.
create function public.forecast_attendance_series(p_institution_id uuid, p_from date, p_to date)
returns table (class_section_id uuid, points jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select app.assert_forecast_window(p_from, p_to);

  with weighted as (
    select
      s.class_section_id as class_section_id,
      date_trunc('week', s.date)::date as week_start,
      sum(case when coalesce((codes.w ->> 'in_denominator')::boolean, false) then coalesce((codes.w ->> 'counts_present')::numeric, 0) else 0 end) as present,
      sum(case when coalesce((codes.w ->> 'in_denominator')::boolean, false) then 1 else 0 end) as denominator
    from public.attendance_sessions s
    join public.attendance_records ar on ar.session_id = s.id and ar.institution_id = p_institution_id
    join public.institutions i on i.id = p_institution_id
    left join lateral (
      select elem as w from jsonb_array_elements(coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb)) elem
      where elem ->> 'code' = ar.status
    ) codes on true
    where s.institution_id = p_institution_id
      and s.period_id is null
      and s.status = 'submitted'
      and s.date >= p_from and s.date < p_to
    group by s.class_section_id, date_trunc('week', s.date)::date
  ),
  section_rows as (
    select
      weighted.class_section_id,
      jsonb_agg(jsonb_build_object('week_start', weighted.week_start, 'present', weighted.present, 'denominator', weighted.denominator) order by weighted.week_start) as points
    from weighted
    where weighted.denominator > 0
    group by weighted.class_section_id
  ),
  school_weeks as (
    select week_start, sum(present) as present, sum(denominator) as denominator
    from weighted
    group by week_start
    having sum(denominator) > 0
  ),
  school_row as (
    select null::uuid as class_section_id, jsonb_agg(jsonb_build_object('week_start', week_start, 'present', present, 'denominator', denominator) order by week_start) as points
    from school_weeks
  )
  select * from section_rows
  union all
  select * from school_row where points is not null;
$$;

revoke execute on function public.forecast_attendance_series(uuid, date, date) from public, anon, authenticated;
grant execute on function public.forecast_attendance_series(uuid, date, date) to service_role;

-- public.enqueue_due_forecasts — runner sweep (mirrors 0077
-- enqueue_due_reports, M15). One forecast.run job per institution per
-- local day, only when the module is on and there is something to
-- forecast (keeps empty tenants/fixtures out of the queue).
create function public.enqueue_due_forecasts(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution record;
  v_today date;
begin
  for v_institution in
    select i.id, coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') as tz
    from public.institutions i
    where app.module_enabled(i.id, 'forecasts')
  loop
    v_today := (p_now at time zone v_institution.tz)::date;

    if exists (
      select 1 from public.attendance_sessions s
      where s.institution_id = v_institution.id
        and s.status = 'submitted'
        and s.date >= v_today - 400
    ) or exists (
      select 1 from public.payments p
      where p.institution_id = v_institution.id
        and p.received_at >= p_now - interval '400 days'
    ) then
      perform app.enqueue_job(
        v_institution.id,
        'forecast.run',
        jsonb_build_object('as_of', v_today),
        'forecast.run:' || v_institution.id || ':' || to_char(v_today, 'YYYYMMDD')
      );
    end if;
  end loop;
end;
$$;

revoke execute on function public.enqueue_due_forecasts(timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_due_forecasts(timestamptz) to service_role;
