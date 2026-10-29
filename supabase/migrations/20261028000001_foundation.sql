-- T-003: schema `app` kernel — RLS helpers, immutability/update triggers,
-- gap-free numbering, grading lookup, dynamic demo reset.
-- Tables referenced here (institutions, institution_sequences, memberships,
-- guardian_students, students, staff, class_sections, subject_assignments,
-- audit_events) land in later migrations (0002-0005). These bodies are
-- plpgsql, so Postgres resolves the relation names at call time, not at
-- CREATE FUNCTION time; T-004/T-010/T-011 tests prove the RLS helpers once
-- those tables exist. `app.audit` itself is NOT created here — it inserts
-- into `audit_events`, which is created in 0003, so it is defined there.

create extension if not exists pgcrypto;

create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------

create function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function app.block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'code:invalid_state' using detail = format(
    '%s on %I.%I is not allowed; this table is immutable history',
    tg_op, tg_table_schema, tg_table_name
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS helpers (05 §5, D4) — stable security definer, search_path pinned,
-- (select auth.uid()) so the planner can cache it per statement.
-- ---------------------------------------------------------------------------

create function app.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid());
$$;

create function app.is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = app.current_user_id()),
    false
  );
end;
$$;

create function app.member_institutions()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select m.institution_id
    from public.memberships m
    where m.user_id = app.current_user_id()
      and m.status = 'active';
end;
$$;

create function app.is_member(p_institution_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.memberships m
    where m.user_id = app.current_user_id()
      and m.institution_id = p_institution_id
      and m.status = 'active'
  );
end;
$$;

create function app.has_role(p_institution_id uuid, p_roles text[])
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.memberships m
    where m.user_id = app.current_user_id()
      and m.institution_id = p_institution_id
      and m.status = 'active'
      and m.role = any(p_roles)
  );
end;
$$;

create function app.staff_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher'];
$$;

create function app.finance_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['owner', 'principal', 'admin', 'accountant'];
$$;

create function app.exam_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['owner', 'principal', 'admin', 'exam_controller'];
$$;

create function app.staff_id(p_institution_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (
    select m.staff_id
    from public.memberships m
    where m.user_id = app.current_user_id()
      and m.institution_id = p_institution_id
      and m.status = 'active'
      and m.staff_id is not null
    limit 1
  );
end;
$$;

create function app.guardian_student_ids(p_institution_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select gs.student_id
    from public.guardian_students gs
    join public.memberships m on m.guardian_id = gs.guardian_id
    where m.user_id = app.current_user_id()
      and m.institution_id = p_institution_id
      and m.status = 'active';
end;
$$;

create function app.own_student_id(p_institution_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (
    select m.student_id
    from public.memberships m
    where m.user_id = app.current_user_id()
      and m.institution_id = p_institution_id
      and m.status = 'active'
      and m.student_id is not null
    limit 1
  );
end;
$$;

create function app.teaches_section(p_institution_id uuid, p_class_section_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := app.staff_id(p_institution_id);
begin
  if v_staff_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.class_sections cs
    where cs.id = p_class_section_id
      and cs.institution_id = p_institution_id
      and cs.class_teacher_id = v_staff_id
  ) or exists (
    select 1
    from public.subject_assignments sa
    join public.class_sections cs on cs.id = sa.class_section_id
    where sa.class_section_id = p_class_section_id
      and cs.institution_id = p_institution_id
      and sa.teacher_id = v_staff_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- app.next_sequence — gap-free human numbers (D15)
-- Pattern tokens: {FY} (Apr-Mar Indian financial year), {YYYY}, {SEQ:n}.
-- Pattern read from institutions.settings->'numbering' keyed by the part of
-- `key` before an optional ':' suffix (e.g. 'receipt_no:2026-27' -> 'receipt_no').
-- ---------------------------------------------------------------------------

create function app.render_sequence_pattern(p_pattern text, p_seq bigint, p_fy_start_month int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rendered text := p_pattern;
  v_fy_start_year int;
  v_fy text;
  v_width text;
  v_seq_str text;
begin
  if p_fy_start_month is null or extract(month from current_date) >= p_fy_start_month then
    v_fy_start_year := extract(year from current_date)::int;
  else
    v_fy_start_year := extract(year from current_date)::int - 1;
  end if;
  v_fy := v_fy_start_year::text || '-' || lpad(((v_fy_start_year + 1) % 100)::text, 2, '0');

  v_rendered := replace(v_rendered, '{FY}', v_fy);
  v_rendered := replace(v_rendered, '{YYYY}', extract(year from current_date)::text);

  v_width := (regexp_match(v_rendered, '\{SEQ:(\d+)\}'))[1];
  if v_width is not null then
    v_seq_str := lpad(p_seq::text, v_width::int, '0');
    v_rendered := regexp_replace(v_rendered, '\{SEQ:\d+\}', v_seq_str);
  end if;

  return v_rendered;
end;
$$;

create function app.next_sequence(p_institution_id uuid, p_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := split_part(p_key, ':', 1);
  v_pattern text;
  v_fy_start_month int;
  v_next bigint;
begin
  select settings->'numbering'->>v_prefix, coalesce((settings->'finance'->>'financial_year_start_month')::int, 4)
  into v_pattern, v_fy_start_month
  from public.institutions
  where id = p_institution_id;

  if v_pattern is null then
    raise exception 'code:invalid_state' using detail = format('No numbering pattern configured for key %s', v_prefix);
  end if;

  insert into public.institution_sequences (institution_id, key, next_value, pattern)
  values (p_institution_id, p_key, 1, v_pattern)
  on conflict (institution_id, key) do update set pattern = excluded.pattern;

  select next_value into v_next
  from public.institution_sequences
  where institution_id = p_institution_id and key = p_key
  for update;

  update public.institution_sequences
  set next_value = v_next + 1
  where institution_id = p_institution_id and key = p_key;

  return app.render_sequence_pattern(v_pattern, v_next, v_fy_start_month);
end;
$$;

-- ---------------------------------------------------------------------------
-- app.grade_for — grading lookup (05 §4.1)
-- ---------------------------------------------------------------------------

create function app.grade_for(p_institution_id uuid, p_scale_key text, p_percentage numeric)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scale jsonb;
  v_grade text;
begin
  select settings->'exams'->'grading_scales'->p_scale_key into v_scale
  from public.institutions
  where id = p_institution_id;

  if v_scale is null then
    raise exception 'code:invalid_state' using detail = format('No grading scale %s configured', p_scale_key);
  end if;

  -- Bands are defined with integer min/max ("21"-"32"); a fractional
  -- percentage (e.g. 32.99) belongs to the band whose integer max it is
  -- still below the next band's min, hence the `< max + 1` exclusive upper
  -- bound rather than `<= max`.
  select elem->>'grade' into v_grade
  from jsonb_array_elements(v_scale) elem
  where p_percentage >= (elem->>'min')::numeric
    and p_percentage < (elem->>'max')::numeric + 1
  limit 1;

  if v_grade is null then
    raise exception 'code:invalid_state' using detail = format('No grade band matches percentage %s', p_percentage);
  end if;

  return v_grade;
end;
$$;

-- ---------------------------------------------------------------------------
-- app.demo_reset — dynamic, FK-topological delete of every tenant table
-- (D19). Refuses non-demo institutions; bypasses immutability triggers only
-- inside this function.
-- ---------------------------------------------------------------------------

create function app.demo_reset(p_institution_id uuid)
returns table(table_name text, deleted_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_demo boolean;
  v_tables text[];
  v_remaining text[];
  v_batch text[];
  v_deps jsonb := '{}'::jsonb;
  v_t text;
  v_s text;
  v_fk record;
  v_ready boolean;
  v_count bigint;
begin
  select is_demo into v_is_demo from public.institutions where id = p_institution_id;

  if v_is_demo is not true then
    raise exception 'code:forbidden' using detail = 'demo_reset is only allowed for demo institutions';
  end if;

  perform set_config('app.allow_reset', 'on', true);

  select coalesce(array_agg(c.table_name), array[]::text[]) into v_tables
  from information_schema.columns c
  where c.table_schema = 'public' and c.column_name = 'institution_id';

  -- Null out self-referencing FK columns first (e.g. results.superseded_by)
  -- so the topological delete below never trips over a self-cycle.
  foreach v_t in array v_tables loop
    for v_fk in
      select a.attname as column_name
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
      where con.contype = 'f'
        and con.conrelid = (format('public.%I', v_t))::regclass
        and con.confrelid = con.conrelid
    loop
      execute format('update public.%I set %I = null where institution_id = $1 and %I is not null', v_t, v_fk.column_name, v_fk.column_name)
      using p_institution_id;
    end loop;
  end loop;

  -- Build a table -> [tables it references] map, restricted to tenant tables.
  foreach v_t in array v_tables loop
    v_deps := v_deps || jsonb_build_object(v_t, (
      select coalesce(jsonb_agg(distinct cf.relname), '[]'::jsonb)
      from pg_constraint con
      join pg_class cf on cf.oid = con.confrelid
      where con.contype = 'f'
        and con.conrelid = (format('public.%I', v_t))::regclass
        and cf.relname = any(v_tables)
        and cf.relname <> v_t
    ));
  end loop;

  v_remaining := v_tables;

  while array_length(v_remaining, 1) > 0 loop
    v_batch := array[]::text[];

    foreach v_t in array v_remaining loop
      v_ready := true;
      foreach v_s in array v_remaining loop
        if v_s <> v_t and (v_deps -> v_s) ? v_t then
          v_ready := false;
          exit;
        end if;
      end loop;
      if v_ready then
        v_batch := v_batch || v_t;
      end if;
    end loop;

    if array_length(v_batch, 1) is null then
      raise exception 'code:internal' using detail = 'demo_reset: circular foreign-key dependency among tenant tables';
    end if;

    foreach v_t in array v_batch loop
      execute format('delete from public.%I where institution_id = $1', v_t) using p_institution_id;
      get diagnostics v_count = row_count;
      table_name := v_t;
      deleted_count := v_count;
      return next;
      v_remaining := array_remove(v_remaining, v_t);
    end loop;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (05 §5): execute only on the helpers RLS policies call directly.
-- next_sequence / grade_for / demo_reset are invoked only from service-role
-- or other security-definer functions, never directly by a client role.
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema app from public;

grant execute on function
  app.current_user_id(),
  app.is_platform_admin(),
  app.member_institutions(),
  app.is_member(uuid),
  app.has_role(uuid, text[]),
  app.staff_roles(),
  app.finance_roles(),
  app.exam_roles(),
  app.staff_id(uuid),
  app.guardian_student_ids(uuid),
  app.own_student_id(uuid),
  app.teaches_section(uuid, uuid)
to authenticated;

revoke execute on function app.next_sequence(uuid, text), app.demo_reset(uuid), app.grade_for(uuid, text, numeric)
from anon, authenticated;
