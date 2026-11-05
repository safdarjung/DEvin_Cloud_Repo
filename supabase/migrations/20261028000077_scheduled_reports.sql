-- M15-T3: migration 0077 part 1 — cron parser, scheduled_reports, write
-- guard, RLS (M15-tasks.md header rulings: Table, Cron, Write guard, RLS).
-- Parts 2 (report documents + source functions) and 3 (enqueue_due_reports
-- sweep) are appended to this same file by T4 and T5.
--
-- Cron = a documented SQL subset: five fields `M H DOM MON DOW`, evaluated
-- in the institution timezone. M/H are single integers (0-59 / 0-23, no
-- leading zero); DOM/MON/DOW are `*` or a comma list of integers/ranges.
-- DOM and DOW restricted together is rejected (avoids cron's OR rule).
-- app.cron_field_match matches one such field against a calendar value;
-- app.cron_next_fire walks local dates to find the next fire instant —
-- Postgres does the timezone math (DST-safe), never TS.
create function app.cron_field_match(p_field text, p_value int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_field = '*' then true
    else exists (
      select 1
      from unnest(string_to_array(p_field, ',')) as part
      where case
        when part ~ '^[0-9]{1,2}-[0-9]{1,2}$' then
          p_value between split_part(part, '-', 1)::int and split_part(part, '-', 2)::int
        when part ~ '^[0-9]{1,2}$' then
          p_value = part::int
        else false
      end
    )
  end;
$$;

revoke execute on function app.cron_field_match(text, int) from public;

create function app.cron_next_fire(p_cron text, p_tz text, p_after timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  -- Same grammar as TS CRON_SUBSET_PATTERN (M15-T2) — M/H plain integers,
  -- DOM/MON/DOW `*` or a comma list of integers/ranges, 1-2 digits each.
  v_pattern text := '^([0-9]|[1-5][0-9]) ([0-9]|1[0-9]|2[0-3]) (\*|[0-9]{1,2}(-[0-9]{1,2})?(,[0-9]{1,2}(-[0-9]{1,2})?)*) (\*|[0-9]{1,2}(-[0-9]{1,2})?(,[0-9]{1,2}(-[0-9]{1,2})?)*) (\*|[0-9]{1,2}(-[0-9]{1,2})?(,[0-9]{1,2}(-[0-9]{1,2})?)*)$';
  v_parts text[];
  v_minute int;
  v_hour int;
  v_dom text;
  v_mon text;
  v_dow text;
  v_date date;
  v_fire timestamptz;
  i int;
begin
  if p_cron !~ v_pattern then
    return null;
  end if;

  v_parts := regexp_split_to_array(p_cron, ' ');
  v_minute := v_parts[1]::int;
  v_hour := v_parts[2]::int;
  v_dom := v_parts[3];
  v_mon := v_parts[4];
  v_dow := v_parts[5];

  -- DOM and DOW both restricted is rejected (avoids cron's OR rule).
  if v_dom <> '*' and v_dow <> '*' then
    return null;
  end if;

  for i in 0..366 loop
    v_date := (p_after at time zone p_tz)::date + i;

    if app.cron_field_match(v_dom, extract(day from v_date)::int)
      and app.cron_field_match(v_mon, extract(month from v_date)::int)
      and app.cron_field_match(v_dow, extract(dow from v_date)::int)
    then
      v_fire := (v_date + make_time(v_hour, v_minute, 0)) at time zone p_tz;
      if v_fire > p_after then
        return v_fire;
      end if;
    end if;
  end loop;

  return null;
end;
$$;

revoke execute on function app.cron_next_fire(text, text, timestamptz) from public;

-- Allowlisted recipient roles per report source (Sources ruling). Unknown
-- source -> null (unreachable while the table's `source` check holds).
create function app.report_source_roles(p_source text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_source
    when 'attendance.daily' then array['owner', 'principal', 'admin']
    when 'finance.defaulters' then array['owner', 'principal', 'admin', 'accountant']
    else null
  end;
$$;

revoke execute on function app.report_source_roles(text) from public;

-- ---------------------------------------------------------------------------
-- scheduled_reports
-- ---------------------------------------------------------------------------

create table public.scheduled_reports (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (length(name) between 1 and 80),
  source text not null check (source in ('attendance.daily', 'finance.defaulters')),
  params jsonb not null default '{}'::jsonb
    check (jsonb_typeof(params) = 'object' and length(params::text) <= 1000),
  cron text not null check (length(cron) <= 100),
  recipient_roles text[] not null check (cardinality(recipient_roles) between 1 and 5),
  status text not null default 'active' check (status in ('active', 'paused')),
  next_run_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, name)
);

create index scheduled_reports_next_run_at_idx
  on public.scheduled_reports (next_run_at)
  where status = 'active';

create trigger set_updated_at
before update on public.scheduled_reports
for each row execute function app.set_updated_at();

-- Write guard (Write guard ruling). Trusted = service_role JWT claim or
-- session_user = 'postgres' (lesson 5). security definer so it can read
-- public.institutions for the timezone regardless of the caller's own
-- select visibility of that table.
create function app.scheduled_reports_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean;
  v_tz text;
  v_recompute boolean;
  v_distinct_count int;
begin
  v_trusted := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres';

  if tg_op = 'INSERT' then
    if not v_trusted then
      new.created_by := app.current_user_id();
    end if;
  elsif not v_trusted and (new.institution_id is distinct from old.institution_id or new.created_by is distinct from old.created_by) then
    raise exception 'code:forbidden' using detail = 'institution_id and created_by are immutable';
  end if;

  select count(distinct r) into v_distinct_count from unnest(new.recipient_roles) as r;
  if v_distinct_count <> cardinality(new.recipient_roles)
    or not (new.recipient_roles <@ app.report_source_roles(new.source))
  then
    raise exception 'code:validation_failed' using detail = 'recipient roles must be unique and allowed for the report source';
  end if;

  v_recompute := tg_op = 'INSERT' or new.cron is distinct from old.cron or new.status is distinct from old.status;

  if v_recompute then
    select coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') into v_tz
    from public.institutions i
    where i.id = new.institution_id;

    new.next_run_at := case when new.status = 'active' then app.cron_next_fire(new.cron, v_tz, now()) end;

    if new.status = 'active' and new.next_run_at is null then
      raise exception 'code:validation_failed' using detail = 'cron never fires';
    end if;
  elsif not v_trusted then
    -- Any other update by a non-trusted caller keeps the existing
    -- next_run_at (users cannot force a run); a trusted caller (the sweep)
    -- keeps whatever value it supplied.
    new.next_run_at := old.next_run_at;
  end if;

  return new;
end;
$$;

create trigger scheduled_reports_before_write
before insert or update on public.scheduled_reports
for each row execute function app.scheduled_reports_before_write();

alter table public.scheduled_reports enable row level security;

-- 07 §2.2 report.schedule: owner/principal/admin only, both read and write;
-- no DELETE policy (pause instead of delete).
create policy scheduled_reports_select on public.scheduled_reports
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy scheduled_reports_insert on public.scheduled_reports
  for insert to authenticated
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy scheduled_reports_update on public.scheduled_reports
  for update to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

-- M15-T4: migration 0077 part 2 — report documents + source functions
-- (M15-tasks.md header rulings: Sources, Report documents). Part 3
-- (enqueue_due_reports sweep) is appended by T5.

-- ---------------------------------------------------------------------------
-- documents: entity type `report` + mime `text/csv` (constraint names
-- confirmed via \d public.documents before writing this). 0071 recreated
-- 0067's documents policies; this part adds its own and never recreates
-- theirs.
-- ---------------------------------------------------------------------------

alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents
  add constraint documents_entity_type_check
  check (entity_type in ('student', 'staff', 'application', 'submission', 'report'));

alter table public.documents drop constraint documents_mime_check;
alter table public.documents
  add constraint documents_mime_check
  check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'text/csv'));

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'text/csv')
where id = 'tenant-docs';

-- app.my_report_ids() — RLS perf helper (P-01 shape): ids of schedules
-- whose institution holds an active membership of the caller with
-- role = any(recipient_roles). Called as (select app.my_report_ids())
-- inside policies (lesson 7 initPlan).
create function app.my_report_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sr.id
  from public.scheduled_reports sr
  join public.memberships m on m.institution_id = sr.institution_id
  where m.user_id = app.current_user_id()
    and m.status = 'active'
    and m.role = any(sr.recipient_roles);
$$;

revoke execute on function app.my_report_ids() from public;
grant execute on function app.my_report_ids() to authenticated;

-- Permissive SELECT for `report` documents: the recipient roles of the
-- owning schedule, nothing broader (narrower than 0067's owner/principal/
-- admin branch on purpose — "readable by principal only" per ruling).
create policy documents_select_report on public.documents
  for select to authenticated
  using (entity_type = 'report' and entity_id = any((select app.my_report_ids())));

-- Restrictive FOR ALL: non-report rows pass through untouched; a `report`
-- row is only ever visible to its recipients, and never writable by an
-- authenticated caller at all (with check always fails for entity_type =
-- 'report') — only the service role (which bypasses RLS) writes them.
create policy documents_report_guard on public.documents
  as restrictive
  for all to authenticated
  using (entity_type <> 'report' or entity_id = any((select app.my_report_ids())))
  with check (entity_type <> 'report');

-- ---------------------------------------------------------------------------
-- Report sources (Sources ruling) — allowlisted security invoker SQL
-- functions, one implementation, called by .rpc() from both the job
-- (service-role client, institution_id is the only filter) and
-- report.export (caller's client, RLS applies on top).
-- ---------------------------------------------------------------------------

-- report_attendance_daily: one row per class section of the academic year
-- containing day d = (p_as_of at time zone tz)::date + p_day_offset (no
-- such year -> zero rows). Weighting matches app.term_attendance_percentage
-- (0009/0070) exactly, scoped to the one daily session (period_id is null)
-- of that section on day d instead of a term's date range.
create function public.report_attendance_daily(
  p_institution_id uuid,
  p_as_of timestamptz,
  p_day_offset int default 0
)
returns table (
  date date,
  grade text,
  section text,
  session_status text,
  enrolled int,
  marked int,
  present_weighted numeric,
  denominator int,
  percentage numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with inst as (
    select coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') as tz
    from public.institutions i
    where i.id = p_institution_id
  ),
  d as (
    select ((p_as_of at time zone (select tz from inst))::date + p_day_offset) as day
  ),
  year as (
    select ay.id
    from public.academic_years ay, d
    where ay.institution_id = p_institution_id
      and d.day between ay.starts_on and ay.ends_on
  ),
  sections as (
    select cs.id as class_section_id, g.display_name as grade, cs.name as section
    from public.class_sections cs
    join public.grades g on g.id = cs.grade_id
    join year y on y.id = cs.academic_year_id
    where cs.institution_id = p_institution_id
  ),
  sess as (
    select s.id as session_id, s.class_section_id, s.status
    from public.attendance_sessions s, d
    where s.institution_id = p_institution_id
      and s.period_id is null
      and s.date = d.day
  ),
  counts as (
    select
      ar.session_id,
      count(*)::int as marked,
      coalesce(sum(case when coalesce((codes.w ->> 'in_denominator')::boolean, false) then coalesce((codes.w ->> 'counts_present')::numeric, 0) else 0 end), 0) as present_weighted,
      coalesce(sum(case when coalesce((codes.w ->> 'in_denominator')::boolean, false) then 1 else 0 end), 0)::int as denominator
    from public.attendance_records ar
    join sess on sess.session_id = ar.session_id
    join public.institutions i on i.id = p_institution_id
    left join lateral (
      select elem as w from jsonb_array_elements(coalesce(i.settings -> 'attendance' -> 'statuses', '[]'::jsonb)) elem
      where elem ->> 'code' = ar.status
      limit 1
    ) codes on true
    where ar.institution_id = p_institution_id
    group by ar.session_id
  )
  select
    d.day as date,
    sections.grade,
    sections.section,
    coalesce(sess.status, 'not_marked') as session_status,
    coalesce((
      select count(*)::int from public.enrolments e
      where e.class_section_id = sections.class_section_id
        and e.institution_id = p_institution_id
        and e.status = 'active'
    ), 0) as enrolled,
    coalesce(counts.marked, 0) as marked,
    coalesce(counts.present_weighted, 0) as present_weighted,
    coalesce(counts.denominator, 0) as denominator,
    round(100 * coalesce(counts.present_weighted, 0) / nullif(coalesce(counts.denominator, 0), 0), 2) as percentage
  from sections
  cross join d
  left join sess on sess.class_section_id = sections.class_section_id
  left join counts on counts.session_id = sess.session_id
  order by sections.grade, sections.section;
$$;

revoke execute on function public.report_attendance_daily(uuid, timestamptz, int) from public, anon;
grant execute on function public.report_attendance_daily(uuid, timestamptz, int) to authenticated, service_role;

-- report_fee_defaulters: invoices issued|part_paid with
-- due_on <= d - p_min_days_overdue; outstanding is the exact
-- (total - paid_total) numeric cast to text (lesson 8, never a float);
-- grade/section come from the student's active enrolment in the invoice's
-- own academic year (left join — an invoice survives a missing enrolment).
create function public.report_fee_defaulters(
  p_institution_id uuid,
  p_as_of timestamptz,
  p_min_days_overdue int default 0
)
returns table (
  admission_no text,
  student text,
  grade text,
  section text,
  invoice_no text,
  due_on date,
  days_overdue int,
  outstanding text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with inst as (
    select coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') as tz
    from public.institutions i
    where i.id = p_institution_id
  ),
  d as (
    select (p_as_of at time zone (select tz from inst))::date as day
  )
  select
    s.admission_no,
    trim(s.first_name || ' ' || coalesce(s.last_name, '')) as student,
    g.display_name as grade,
    cs.name as section,
    inv.invoice_no,
    inv.due_on,
    (d.day - inv.due_on)::int as days_overdue,
    (inv.total - inv.paid_total)::text as outstanding
  from public.invoices inv
  cross join d
  join public.students s on s.id = inv.student_id and s.institution_id = inv.institution_id
  left join public.enrolments e
    on e.student_id = inv.student_id
    and e.academic_year_id = inv.academic_year_id
    and e.institution_id = inv.institution_id
    and e.status = 'active'
  left join public.class_sections cs on cs.id = e.class_section_id and cs.institution_id = inv.institution_id
  left join public.grades g on g.id = cs.grade_id and g.institution_id = inv.institution_id
  where inv.institution_id = p_institution_id
    and inv.status in ('issued', 'part_paid')
    and inv.due_on <= d.day - p_min_days_overdue
  order by inv.due_on, s.admission_no
  limit 20000;
$$;

revoke execute on function public.report_fee_defaulters(uuid, timestamptz, int) from public, anon;
grant execute on function public.report_fee_defaulters(uuid, timestamptz, int) to authenticated, service_role;

-- M15-T5: migration 0077 part 3 — enqueue_due_reports sweep (Scheduling,
-- Idempotency rulings). `runOnceCore` calls this once per runner cadence
-- before claiming (sweep errors are logged and never block the claim
-- loop — TS side, M15-T8). A module switched off leaves its due rows
-- untouched (feature off); the overdue window runs once when switched
-- back on. service_role only — never callable by an authenticated session.
create function public.enqueue_due_reports()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_tz text;
  v_count int := 0;
begin
  for v_row in
    select sr.id, sr.institution_id, sr.cron, sr.next_run_at
    from public.scheduled_reports sr
    where sr.status = 'active'
      and sr.next_run_at <= now()
      and app.module_enabled(sr.institution_id, 'scheduled_reports')
    order by sr.next_run_at
    limit 200
    for update skip locked
  loop
    -- Payload built from the already-locked row (lesson 3); idempotency
    -- key = run window (schedule x fire minute, UTC) — one job per
    -- window even if two sweeps race before the lock is released.
    perform app.enqueue_job(
      v_row.institution_id,
      'report.generate',
      jsonb_build_object('scheduled_report_id', v_row.id, 'fire_at', v_row.next_run_at),
      'report.generate:' || v_row.id::text || ':' || to_char(v_row.next_run_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI"Z"')
    );

    select coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') into v_tz
    from public.institutions i
    where i.id = v_row.institution_id;

    -- Missed windows are skipped: advance from the later of the missed
    -- next_run_at or now(), so an overdue-by-days schedule fires once,
    -- not once per missed window.
    update public.scheduled_reports
    set next_run_at = app.cron_next_fire(v_row.cron, v_tz, greatest(v_row.next_run_at, now()))
    where id = v_row.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.enqueue_due_reports() from public, anon, authenticated;
grant execute on function public.enqueue_due_reports() to service_role;
