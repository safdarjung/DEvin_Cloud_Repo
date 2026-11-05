-- M21-T2: forecasts module tables (0094 part 1) — forecast_backtests,
-- forecasts, constraints, RLS (06-backend-packets/M21-tasks.md rulings
-- "Tables", "RLS"). Series functions + sweep land in part 2 (T3, same
-- file, unmerged).
--
-- No per-student forecasts (structural): exactly two kinds,
-- fee_collections_term (institution-wide, series_key 'fees:term') and
-- attendance_rate_week (school-wide 'attendance:school' or one section
-- 'attendance:section:<class_section_id>'). The shape check on both tables
-- pins kind/series_key/class_section_id/unit together so no row can drift
-- into an invalid combination.
--
-- Forecasts are read-only numbers: service role (the forecast.run job)
-- writes both tables directly as table owner, bypassing RLS; there is no
-- INSERT/UPDATE/DELETE policy for authenticated (BRIEF-COMMON lesson 3/7
-- — a definer wrapper would need its own re-validation it doesn't need
-- here, since nothing user-facing writes these rows).

create table public.forecast_backtests (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  series_key text not null,
  kind text not null check (kind in ('fee_collections_term', 'attendance_rate_week')),
  class_section_id uuid references public.class_sections (id),
  unit text not null check (unit in ('paise', 'pct')),
  model text not null check (model in ('moving_average_v1', 'seasonal_naive_v1')),
  origin_start date not null,
  n_train int not null check (n_train >= 1),
  holdout jsonb not null check (jsonb_typeof(holdout) = 'array' and jsonb_array_length(holdout) = 3),
  mape numeric(8, 4) not null check (mape >= 0),
  params jsonb not null,
  as_of date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forecast_backtests_shape_check check (
    (kind = 'fee_collections_term' and series_key = 'fees:term' and class_section_id is null and unit = 'paise')
    or (kind = 'attendance_rate_week' and unit = 'pct' and (
      (class_section_id is null and series_key = 'attendance:school')
      or (class_section_id is not null and series_key = 'attendance:section:' || class_section_id::text)
    ))
  ),
  constraint forecast_backtests_series_model_key unique (institution_id, series_key, model),
  -- FK target for forecasts' composite FK below (lesson: "a backtest row
  -- exists before a forecast is shown", same series and model).
  constraint forecast_backtests_fk_target_key unique (id, institution_id, series_key, model)
);

create trigger set_updated_at
before update on public.forecast_backtests
for each row execute function app.set_updated_at();

alter table public.forecast_backtests enable row level security;

create policy forecast_backtests_select on public.forecast_backtests
  for select to authenticated
  using (
    (kind = 'fee_collections_term' and institution_id = any((select app.my_institution_ids(app.finance_roles()))))
    or (kind = 'attendance_rate_week' and institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'exam_controller']))))
    or (kind = 'attendance_rate_week' and class_section_id = any((select app.my_taught_section_ids())))
  );

create table public.forecasts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  series_key text not null,
  kind text not null check (kind in ('fee_collections_term', 'attendance_rate_week')),
  class_section_id uuid references public.class_sections (id),
  unit text not null check (unit in ('paise', 'pct')),
  model text not null check (model in ('moving_average_v1', 'seasonal_naive_v1')),
  backtest_id uuid not null,
  horizon int not null check (horizon between 1 and 3),
  period_start date not null,
  period_label text not null check (length(period_label) between 1 and 40),
  point numeric(16, 2) not null,
  lower numeric(16, 2) not null,
  upper numeric(16, 2) not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object' and length(evidence::text) <= 4000),
  as_of date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forecasts_shape_check check (
    (kind = 'fee_collections_term' and series_key = 'fees:term' and class_section_id is null and unit = 'paise')
    or (kind = 'attendance_rate_week' and unit = 'pct' and (
      (class_section_id is null and series_key = 'attendance:school')
      or (class_section_id is not null and series_key = 'attendance:section:' || class_section_id::text)
    ))
  ),
  constraint forecasts_bounds_check check (0 <= lower and lower <= point and point <= upper),
  constraint forecasts_pct_upper_check check (unit <> 'pct' or upper <= 100),
  constraint forecasts_series_horizon_key unique (institution_id, series_key, horizon),
  constraint forecasts_backtest_fk foreign key (backtest_id, institution_id, series_key, model)
    references public.forecast_backtests (id, institution_id, series_key, model) on delete cascade
);

create trigger set_updated_at
before update on public.forecasts
for each row execute function app.set_updated_at();

alter table public.forecasts enable row level security;

create policy forecasts_select on public.forecasts
  for select to authenticated
  using (
    (kind = 'fee_collections_term' and institution_id = any((select app.my_institution_ids(app.finance_roles()))))
    or (kind = 'attendance_rate_week' and institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'exam_controller']))))
    or (kind = 'attendance_rate_week' and class_section_id = any((select app.my_taught_section_ids())))
  );

-- ---------------------------------------------------------------------------
-- M21-T3: series sources + sweep (0094 part 2, same file, unmerged — see
-- part 1's header). Rulings "Series sources", "Scheduling". The two series
-- functions are `security invoker`: only the forecast.run job (service
-- role) ever calls them, so the explicit p_institution_id filters are the
-- real scope, not RLS (lesson 7 — these are plain table scans, not RLS
-- policies, so no per-row definer call concern).
-- ---------------------------------------------------------------------------

-- public.assert_forecast_window — plpgsql helper so the pure-SQL
-- forecast_attendance_series below can still raise 'code:validation_failed'
-- (plain `language sql` functions have no RAISE; a leading
-- `select public.assert_forecast_window(...)` statement whose result is
-- discarded gives the same effect). Kept in `public`, not `app`: an
-- `app.*` function callable by service_role (directly or via the default
-- PUBLIC execute grant new app functions get until revoked, see 0003's
-- note) would fail grants.test.ts's "no app function is granted to
-- service_role directly" — this helper is only ever reached through a
-- public, service-role-only series function, exactly like
-- forecast_fee_series and forecast_attendance_series themselves.
create function public.assert_forecast_window(p_from date, p_to date)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_to <= p_from or (p_to - p_from) > 400 then
    raise exception 'code:validation_failed' using detail = 'attendance window must be positive and at most 400 days';
  end if;
end;
$$;

revoke execute on function public.assert_forecast_window(date, date) from public, anon, authenticated;
grant execute on function public.assert_forecast_window(date, date) to service_role;

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
  select public.assert_forecast_window(p_from, p_to);

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
