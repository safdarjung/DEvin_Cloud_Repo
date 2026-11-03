-- MOD-T12: app.module_catalog + app.module_enabled — the SQL mirror of
-- src/lib/modules/catalog.ts's MODULES / isModuleEnabled (D45). Defined
-- once, here; later milestones only insert a new app.module_catalog row
-- (on conflict do update) and never re-create app.module_enabled itself.
--
-- `requires` has no column here — it is hardcoded in app.module_enabled's
-- body (the same four edges as the TS catalog: substitution, online_payments,
-- mastery, agents). A future `requires` key needs app.module_enabled edited
-- in a new migration, same as any other logic change to it.
--
-- Re-creates app.block_attendance_on_holiday (0075, M13 "Lane B" inline
-- predicate) to call app.module_enabled instead of reading
-- institutions.settings directly — the only inlining function the
-- `settings->'modules'` grep found.

create table app.module_catalog (
  key text primary key,
  default_enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table app.module_catalog from public, anon, authenticated;

create trigger set_updated_at
before update on app.module_catalog
for each row execute function app.set_updated_at();

insert into app.module_catalog (key, default_enabled) values
  ('core', true),
  ('people', true),
  ('academic_structure', true),
  ('attendance', true),
  ('fees', true),
  ('notifications', true),
  ('timetable', true),
  ('assignments', true),
  ('lesson_plans', true),
  ('question_bank', true),
  ('exams', true),
  ('admissions', true),
  ('website', true),
  ('staff_attendance', true),
  ('substitution', true),
  ('student_lifecycle', true),
  ('finance_plus', true),
  ('online_payments', true),
  ('facilities', true),
  ('transport', true),
  ('calendar', true),
  ('announcements', true),
  ('email', true),
  ('sms', true),
  ('scheduled_reports', false),
  ('ai_teacher', true),
  ('ai_student', true),
  ('ai_briefings', true),
  ('insights', false),
  ('mastery', false),
  ('forecasts', false),
  ('agents', false),
  ('workflows', false)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- app.module_enabled — core keys always true; optional keys = stored boolean
-- (institutions.settings->'modules'->key) falling back to the catalog
-- default, AND every `requires` key (recursive). Unknown key raises.
-- ---------------------------------------------------------------------------

create function app.module_enabled(p_institution_id uuid, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_default boolean;
  v_raw text;
  v_stored boolean;
  v_req text;
  v_requires text[] := case p_key
    when 'substitution' then array['staff_attendance', 'timetable']
    when 'online_payments' then array['finance_plus']
    when 'mastery' then array['exams']
    when 'agents' then array['ai_teacher']
    else array[]::text[]
  end;
begin
  select default_enabled into v_default from app.module_catalog where key = p_key;
  if not found then
    raise exception 'code:internal' using detail = 'unknown module key';
  end if;

  if p_key in ('core', 'people', 'academic_structure', 'attendance', 'fees', 'notifications') then
    return true;
  end if;

  foreach v_req in array v_requires loop
    if not app.module_enabled(p_institution_id, v_req) then
      return false;
    end if;
  end loop;

  select settings -> 'modules' ->> p_key into v_raw
  from public.institutions
  where id = p_institution_id;

  -- Security review (MEDIUM, 2026-11-03): a stray non-boolean value in
  -- settings.modules.<key> must degrade to the catalog default, same as
  -- isModuleEnabled's defensive read in TS, instead of raising.
  v_stored := case when v_raw in ('true', 'false') then v_raw::boolean else null end;

  return coalesce(v_stored, v_default, false);
end;
$$;

revoke all on function app.module_enabled(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.block_attendance_on_holiday (0075) — re-created: inline
-- `coalesce((i.settings->'modules'->>'calendar')::boolean, true)` replaced
-- by app.module_enabled(new.institution_id, 'calendar'). Body otherwise
-- identical to 0075's definition. Do not edit src/modules/attendance/*.
-- ---------------------------------------------------------------------------

create or replace function app.block_attendance_on_holiday()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocked boolean;
begin
  select exists (
    select 1
    from public.academic_calendar_events e
    where e.institution_id = new.institution_id
      and e.kind = 'holiday'
      and new.date between e.starts_on and e.ends_on
  ) into v_blocked;

  if v_blocked and app.module_enabled(new.institution_id, 'calendar') then
    raise exception 'code:invalid_state' using detail = 'attendance cannot be taken on a school holiday';
  end if;

  return new;
end;
$$;
