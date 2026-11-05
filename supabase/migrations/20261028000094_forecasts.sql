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
