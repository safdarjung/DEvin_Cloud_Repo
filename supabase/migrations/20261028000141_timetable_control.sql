-- 0141: timetable control — reasons on every change, configurable suggestion
-- rules, named snapshots, rollback and version restore (owner brief
-- 2026-11-11: "better control over the dynamic timetable and suggestions and
-- notes why it's happening ... options to configure and rollback").
--
-- Tables
--   timetable_changes    append-only change log (who, when, before -> after,
--                        why). block_mutation stops update/delete for everyone
--                        except app.demo_reset (app.allow_reset). No write
--                        policy and no write grant: rows come only from the
--                        definers below and the substitutions trigger.
--   timetable_rules      one row per institution; `rules` jsonb is validated in
--                        TS (src/modules/timetable/rules.ts, unknown or bad keys
--                        fall back to defaults). Written only by
--                        set_timetable_rules, which logs the change + reason.
--   timetable_snapshots  named copy of a version's slots ("before exam week");
--                        owner/principal/admin insert, immutable afterwards.
--
-- Functions (app.* core revoked from everyone + public.* thin wrapper granted
-- to authenticated, same split as 0069's publish_timetable). All re-check
-- owner/principal/admin (timetable.manage) for the row's own institution.
--   apply_timetable_changes  the one write path for cell edits (manual,
--                            suggestion, snapshot restore, rollback). Pre-checks
--                            teacher/room clashes for a readable message (the
--                            0069 unique constraints stay the backstop); a
--                            published version needs a note (a rollback does
--                            not: it restores exactly the undone change's
--                            `before`, server-side); one log row per changed cell.
--   set_timetable_rules      upsert the rules row + log (reason required).
--   publish_timetable_version  draft -> published via app.publish_timetable,
--                            or archived -> published (restore, note required)
--                            archiving the year's current version; logs either.
--   undo_substitution        cancels the substitution a `cover` change made,
--                            logged as a rollback of that change.
--   my_section_covers        (read) a student's/guardian's own sections' covers
--                            on a date: who covers + subject, no note.
--
-- Replaced: app.guard_timetable_slots_write gains the transaction-local GUC
-- app.allow_timetable_slot_edit, set only by app.apply_timetable_changes, so
-- a published version's slots change only through a logged, noted edit.
-- Trigger: app.log_substitution_change logs every substitution assign/cancel.

-- ---------------------------------------------------------------------------
-- timetable_changes
-- ---------------------------------------------------------------------------

create table public.timetable_changes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  version_id uuid references public.timetable_versions (id),
  kind text not null check (kind in ('manual', 'suggestion', 'substitution', 'rollback', 'restore', 'publish', 'rules')),
  action text not null check (action in ('add', 'change', 'remove', 'cover', 'uncover', 'publish', 'restore', 'rules')),
  -- The cell (section x weekday x period). No FK on section/period: a log row
  -- must not stop a period or section being retired later.
  class_section_id uuid,
  weekday int check (weekday between 1 and 6),
  period_id uuid,
  on_date date,
  substitution_id uuid references public.substitutions (id),
  teacher_id uuid,
  prev_teacher_id uuid,
  label text check (char_length(label) <= 200),
  before jsonb,
  after jsonb,
  reason text not null check (char_length(reason) between 1 and 500),
  rule_codes text[] not null default '{}',
  reverts_change_id uuid references public.timetable_changes (id),
  actor_id uuid references public.profiles (id),
  actor_name text check (char_length(actor_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timetable_changes_reverts_key unique (reverts_change_id),
  check ((class_section_id is null) = (weekday is null) and (weekday is null) = (period_id is null)),
  check (version_id is not null or action = 'rules')
);

create index timetable_changes_institution_created_idx on public.timetable_changes (institution_id, created_at desc);
create index timetable_changes_cell_idx on public.timetable_changes (version_id, class_section_id, weekday, period_id, created_at desc);
create index timetable_changes_section_date_idx on public.timetable_changes (class_section_id, on_date);
create index timetable_changes_substitution_idx on public.timetable_changes (substitution_id);

create trigger set_updated_at
before update on public.timetable_changes
for each row execute function app.set_updated_at();

create trigger block_mutation
before update or delete on public.timetable_changes
for each row execute function app.block_mutation();

alter table public.timetable_changes enable row level security;

-- owner/principal/admin: every row. Everyone else: only cell rows of the
-- currently published version that explain their own timetable — a teacher
-- whose slot it was or is (or who teaches the section), a student/guardian of
-- that section. Rules/publish rows (no cell) stay manager-only. Substitution
-- rows (a cover, its cancel or undo) carry the leader's note or the leave
-- fact, so like 0070's substitutions_select only the two teachers involved
-- read them; students/guardians get a fixed line from my_section_covers.
create policy timetable_changes_select on public.timetable_changes
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      class_section_id is not null
      and institution_id = any((select app.member_institutions()))
      and (
        teacher_id = any((select app.my_staff_ids()))
        or prev_teacher_id = any((select app.my_staff_ids()))
        or (
          substitution_id is null
          and (
            class_section_id = any((select app.my_taught_section_ids()))
            or class_section_id = any((select app.my_student_section_ids()))
          )
        )
      )
      and exists (
        select 1 from public.timetable_versions v
        where v.id = timetable_changes.version_id and v.status = 'published'
      )
    )
  );

revoke all on public.timetable_changes from anon, authenticated;
grant select on public.timetable_changes to authenticated;
grant all on public.timetable_changes to service_role;

-- ---------------------------------------------------------------------------
-- timetable_rules
-- ---------------------------------------------------------------------------

create table public.timetable_rules (
  institution_id uuid primary key references public.institutions (id),
  rules jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object' and pg_column_size(rules) <= 16384),
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
before update on public.timetable_rules
for each row execute function app.set_updated_at();

alter table public.timetable_rules enable row level security;

create policy timetable_rules_select on public.timetable_rules
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.timetable_rules from anon, authenticated;
grant select on public.timetable_rules to authenticated;
grant all on public.timetable_rules to service_role;

-- ---------------------------------------------------------------------------
-- timetable_snapshots
-- ---------------------------------------------------------------------------

create table public.timetable_snapshots (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  version_id uuid not null references public.timetable_versions (id),
  name text not null check (char_length(name) between 1 and 60),
  slots jsonb not null check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) <= 5000),
  created_by uuid not null references public.profiles (id) default app.current_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index timetable_snapshots_version_idx on public.timetable_snapshots (version_id, created_at desc);

create trigger set_updated_at
before update on public.timetable_snapshots
for each row execute function app.set_updated_at();

create trigger block_mutation
before update or delete on public.timetable_snapshots
for each row execute function app.block_mutation();

alter table public.timetable_snapshots enable row level security;

create policy timetable_snapshots_select on public.timetable_snapshots
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

create policy timetable_snapshots_insert on public.timetable_snapshots
  for insert to authenticated
  with check (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and created_by = (select app.current_user_id())
    and exists (
      select 1 from public.timetable_versions v
      where v.id = timetable_snapshots.version_id and v.institution_id = timetable_snapshots.institution_id
    )
  );

revoke all on public.timetable_snapshots from anon, authenticated;
grant select, insert on public.timetable_snapshots to authenticated;
grant all on public.timetable_snapshots to service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers (revoked from everyone; called only by the definers below
-- and the substitutions trigger).
-- ---------------------------------------------------------------------------

-- "VI-A · Mon · Period 3"
create function app.tt_cell_label(p_section_id uuid, p_weekday int, p_period_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select concat_ws(' · ',
    (select coalesce(g.code, '?') || '-' || cs.name
       from public.class_sections cs left join public.grades g on g.id = cs.grade_id
      where cs.id = p_section_id),
    (array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[p_weekday],
    (select p.name from public.periods p where p.id = p_period_id));
$$;

revoke execute on function app.tt_cell_label(uuid, int, uuid) from public, anon, authenticated;

-- What a cell holds, with names frozen at the time of the change.
create function app.tt_cell_json(p_subject_id uuid, p_teacher_id uuid, p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_subject_id is null and p_teacher_id is null then null else jsonb_build_object(
    'subjectId', p_subject_id,
    'subject', (select s.name from public.subjects s where s.id = p_subject_id),
    'teacherId', p_teacher_id,
    'teacher', (select st.full_name from public.staff st where st.id = p_teacher_id),
    'roomId', p_room_id,
    'room', (select r.name from public.rooms r where r.id = p_room_id)
  ) end;
$$;

revoke execute on function app.tt_cell_json(uuid, uuid, uuid) from public, anon, authenticated;

-- The actor's display name: their staff name in this institution, else profile name.
create function app.tt_actor_name(p_user_id uuid, p_institution_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(coalesce(
    (select st.full_name from public.memberships m join public.staff st on st.id = m.staff_id
      where m.user_id = p_user_id and m.institution_id = p_institution_id limit 1),
    (select pr.full_name from public.profiles pr where pr.id = p_user_id),
    'School office'), 120);
$$;

revoke execute on function app.tt_actor_name(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.guard_timetable_slots_write — replaced: same body as 0069 plus the
-- app.allow_timetable_slot_edit bypass (set only by apply_timetable_changes).
-- ---------------------------------------------------------------------------

create or replace function app.guard_timetable_slots_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version_id uuid := coalesce(new.version_id, old.version_id);
  v_status text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return coalesce(new, old);
  end if;

  if current_setting('app.allow_timetable_slot_edit', true) = 'on' then
    return coalesce(new, old);
  end if;

  select status into v_status from public.timetable_versions where id = v_version_id;

  if v_status is distinct from 'draft' then
    raise exception 'code:invalid_state' using detail = 'timetable slots can only be written while their version is draft';
  end if;

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_timetable_changes
--
-- p_changes: [{ sectionId, weekday, periodId,
--               after: { subjectId, teacherId, roomId? } | null,   -- null clears the cell
--               expect?: { subjectId, teacherId, roomId? } | null,  -- optional precondition
--               reason?: text, rules?: [text] }]
-- ---------------------------------------------------------------------------

create function app.apply_timetable_changes(
  p_version_id uuid,
  p_kind text,
  p_changes jsonb,
  p_note text default null,
  p_reverts_change_id uuid default null
)
returns setof public.timetable_changes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_version public.timetable_versions;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_actor_name text;
  v_change jsonb;
  v_idx int := -1;
  v_section uuid;
  v_weekday int;
  v_period uuid;
  v_after jsonb;
  v_expect jsonb;
  v_subject uuid;
  v_teacher uuid;
  v_room uuid;
  v_before public.timetable_slots;
  v_slot_id uuid;
  v_action text;
  v_reason text;
  v_label text;
  v_clash text;
  v_reverted public.timetable_changes;
  v_row public.timetable_changes;
  v_count int := 0;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_kind is null or p_kind not in ('manual', 'suggestion', 'restore', 'rollback') then
    raise exception 'code:validation_failed' using detail = 'unknown change kind';
  end if;

  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 500 then
    raise exception 'code:validation_failed' using detail = 'changes must list 1 to 500 periods';
  end if;

  select * into v_version from public.timetable_versions where id = p_version_id for update;
  if v_version.id is null then
    raise exception 'code:not_found' using detail = 'timetable version not found';
  end if;

  if not app.has_role(v_version.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold timetable.manage for this institution';
  end if;

  if v_version.status = 'archived' then
    raise exception 'code:invalid_state' using detail = 'this version is archived; restore it or copy it to a new draft before editing';
  end if;

  if v_version.status = 'published' and v_note is null and p_kind <> 'rollback' then
    raise exception 'code:validation_failed' using detail = 'a note is required to change a published timetable';
  end if;

  if p_kind = 'rollback' then
    if p_reverts_change_id is null or jsonb_array_length(p_changes) <> 1 then
      raise exception 'code:validation_failed' using detail = 'a rollback undoes exactly one named change';
    end if;
    select * into v_reverted from public.timetable_changes where id = p_reverts_change_id;
    if v_reverted.id is null or v_reverted.version_id is distinct from p_version_id or v_reverted.class_section_id is null
      or v_reverted.substitution_id is not null
    then
      raise exception 'code:not_found' using detail = 'change to undo not found in this version';
    end if;
  elsif p_reverts_change_id is not null then
    raise exception 'code:validation_failed' using detail = 'only a rollback names a change to undo';
  end if;

  v_actor_name := app.tt_actor_name(v_caller, v_version.institution_id);
  perform set_config('app.allow_timetable_slot_edit', 'on', true);

  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_idx := v_idx + 1;
    v_section := (v_change ->> 'sectionId')::uuid;
    v_weekday := (v_change ->> 'weekday')::int;
    v_period := (v_change ->> 'periodId')::uuid;

    if v_weekday is null or v_weekday not between 1 and 6
      or not exists (select 1 from public.class_sections cs where cs.id = v_section and cs.institution_id = v_version.institution_id)
      or not exists (select 1 from public.periods p where p.id = v_period and p.institution_id = v_version.institution_id)
    then
      raise exception 'code:validation_failed' using detail = format('change %s: unknown section, day or period', v_idx);
    end if;

    if p_kind = 'rollback' and (v_reverted.class_section_id, v_reverted.weekday, v_reverted.period_id) is distinct from (v_section, v_weekday, v_period) then
      raise exception 'code:validation_failed' using detail = 'a rollback must target the same period as the change it undoes';
    end if;

    v_label := app.tt_cell_label(v_section, v_weekday, v_period);
    -- A rollback puts back exactly what the undone change replaced, and only
    -- while the cell still holds what it wrote; the caller's after/expect are ignored.
    v_after := case
      when p_kind = 'rollback' then v_reverted.before
      when jsonb_typeof(v_change -> 'after') = 'object' then v_change -> 'after'
    end;

    select * into v_before from public.timetable_slots
    where version_id = p_version_id and class_section_id = v_section and weekday = v_weekday and period_id = v_period
    for update;

    if p_kind = 'rollback' or v_change ? 'expect' then
      v_expect := case
        when p_kind = 'rollback' then v_reverted.after
        when jsonb_typeof(v_change -> 'expect') = 'object' then v_change -> 'expect'
      end;
      if (v_expect is null and v_before.id is not null)
        or (v_expect is not null and (
          v_before.id is null
          or v_before.subject_id is distinct from (v_expect ->> 'subjectId')::uuid
          or v_before.teacher_id is distinct from (v_expect ->> 'teacherId')::uuid
          or v_before.room_id is distinct from nullif(v_expect ->> 'roomId', '')::uuid
        ))
      then
        raise exception 'code:conflict' using detail = format('section double-booked at change %s: %s no longer holds what this change expects', v_idx, v_label);
      end if;
    end if;

    if v_after is null then
      if v_before.id is null then
        continue;
      end if;
      delete from public.timetable_slots where id = v_before.id;
      v_slot_id := v_before.id;
      v_action := 'remove';
      v_subject := null;
      v_teacher := null;
      v_room := null;
    else
      v_subject := (v_after ->> 'subjectId')::uuid;
      v_teacher := (v_after ->> 'teacherId')::uuid;
      v_room := nullif(v_after ->> 'roomId', '')::uuid;

      if not exists (select 1 from public.subjects s where s.id = v_subject and s.institution_id = v_version.institution_id)
        or v_teacher is null or not app.staff_in_institution(v_teacher, v_version.institution_id)
        or (v_room is not null and not exists (select 1 from public.rooms r where r.id = v_room and r.institution_id = v_version.institution_id))
      then
        raise exception 'code:validation_failed' using detail = format('change %s: unknown subject, teacher or room', v_idx);
      end if;

      if v_before.id is not null and v_before.subject_id = v_subject and v_before.teacher_id = v_teacher
        and v_before.room_id is not distinct from v_room
      then
        continue;
      end if;

      select app.tt_cell_label(ts.class_section_id, ts.weekday, ts.period_id) into v_clash
      from public.timetable_slots ts
      where ts.version_id = p_version_id and ts.teacher_id = v_teacher and ts.weekday = v_weekday
        and ts.period_id = v_period and ts.class_section_id <> v_section
      limit 1;
      if v_clash is not null then
        raise exception 'code:conflict' using detail = format('teacher double-booked at change %s: %s already teaches %s then',
          v_idx, (select st.full_name from public.staff st where st.id = v_teacher), v_clash);
      end if;

      if v_room is not null then
        select app.tt_cell_label(ts.class_section_id, ts.weekday, ts.period_id) into v_clash
        from public.timetable_slots ts
        where ts.version_id = p_version_id and ts.room_id = v_room and ts.weekday = v_weekday
          and ts.period_id = v_period and ts.class_section_id <> v_section
        limit 1;
        if v_clash is not null then
          raise exception 'code:conflict' using detail = format('room double-booked at change %s: %s is used by %s then',
            v_idx, (select r.name from public.rooms r where r.id = v_room), v_clash);
        end if;
      end if;

      if v_before.id is null then
        insert into public.timetable_slots (institution_id, version_id, class_section_id, subject_id, teacher_id, room_id, weekday, period_id)
        values (v_version.institution_id, p_version_id, v_section, v_subject, v_teacher, v_room, v_weekday, v_period)
        returning id into v_slot_id;
        v_action := 'add';
      else
        update public.timetable_slots
        set subject_id = v_subject, teacher_id = v_teacher, room_id = v_room
        where id = v_before.id;
        v_slot_id := v_before.id;
        v_action := 'change';
      end if;
    end if;

    v_reason := nullif(btrim(coalesce(v_change ->> 'reason', '')), '');
    v_reason := case
      when v_reason is not null and v_note is not null and p_kind <> 'rollback' then v_reason || ' Note: ' || v_note
      when v_reason is not null then v_reason
      when v_note is not null then v_note
      else 'Edited on the draft (no note given)'
    end;

    insert into public.timetable_changes (
      institution_id, version_id, kind, action, class_section_id, weekday, period_id,
      teacher_id, prev_teacher_id, label, before, after, reason, rule_codes,
      reverts_change_id, actor_id, actor_name
    )
    values (
      v_version.institution_id, p_version_id, p_kind, v_action, v_section, v_weekday, v_period,
      v_teacher, v_before.teacher_id, v_label,
      app.tt_cell_json(v_before.subject_id, v_before.teacher_id, v_before.room_id),
      app.tt_cell_json(v_subject, v_teacher, v_room),
      left(v_reason, 500),
      coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(v_change -> 'rules') = 'array' then v_change -> 'rules' else '[]'::jsonb end)), '{}'),
      p_reverts_change_id, v_caller, v_actor_name
    )
    returning * into v_row;

    v_count := v_count + 1;
    return next v_row;
  end loop;

  if v_count > 0 then
    perform app.audit(
      v_version.institution_id, v_caller, 'timetable.changes.applied', 'timetable_versions', v_version.id,
      null, jsonb_build_object('kind', p_kind, 'count', v_count), null
    );
  end if;

  return;
exception
  when unique_violation then
    if sqlerrm like '%timetable_changes_reverts_key%' then
      raise exception 'code:conflict' using detail = 'that change has already been undone';
    end if;
    raise exception 'code:conflict' using detail = 'a period clashes with another booking (teacher, room or section already taken)';
end;
$$;

revoke execute on function app.apply_timetable_changes(uuid, text, jsonb, text, uuid) from public, anon, authenticated;

create function public.apply_timetable_changes(
  p_version_id uuid,
  p_kind text,
  p_changes jsonb,
  p_note text default null,
  p_reverts_change_id uuid default null
)
returns setof public.timetable_changes
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query select * from app.apply_timetable_changes(p_version_id, p_kind, p_changes, p_note, p_reverts_change_id);
end;
$$;

revoke execute on function public.apply_timetable_changes(uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.apply_timetable_changes(uuid, text, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- set_timetable_rules
-- ---------------------------------------------------------------------------

create function app.set_timetable_rules(
  p_institution_id uuid,
  p_rules jsonb,
  p_reason text,
  p_reverts_change_id uuid default null
)
returns public.timetable_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_before jsonb;
  v_reverted public.timetable_changes;
  v_row public.timetable_rules;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold timetable.manage for this institution';
  end if;

  if v_reason is null then
    raise exception 'code:validation_failed' using detail = 'a reason is required to change the timetable rules';
  end if;

  if jsonb_typeof(p_rules) is distinct from 'object' then
    raise exception 'code:validation_failed' using detail = 'rules must be an object';
  end if;

  if p_reverts_change_id is not null then
    select * into v_reverted from public.timetable_changes where id = p_reverts_change_id;
    if v_reverted.id is null or v_reverted.institution_id <> p_institution_id or v_reverted.action <> 'rules' then
      raise exception 'code:not_found' using detail = 'rules change to undo not found';
    end if;
  end if;

  select rules into v_before from public.timetable_rules where institution_id = p_institution_id for update;

  insert into public.timetable_rules (institution_id, rules, updated_by)
  values (p_institution_id, p_rules, v_caller)
  on conflict (institution_id) do update set rules = excluded.rules, updated_by = excluded.updated_by
  returning * into v_row;

  insert into public.timetable_changes (institution_id, kind, action, before, after, reason, reverts_change_id, actor_id, actor_name)
  values (
    p_institution_id,
    case when p_reverts_change_id is null then 'rules' else 'rollback' end,
    'rules', v_before, p_rules, left(v_reason, 500), p_reverts_change_id, v_caller,
    app.tt_actor_name(v_caller, p_institution_id)
  );

  perform app.audit(p_institution_id, v_caller, 'timetable.rules.set', 'timetable_rules', null, null, null, null);

  return v_row;
exception
  when unique_violation then
    raise exception 'code:conflict' using detail = 'that change has already been undone';
end;
$$;

revoke execute on function app.set_timetable_rules(uuid, jsonb, text, uuid) from public, anon, authenticated;

create function public.set_timetable_rules(
  p_institution_id uuid,
  p_rules jsonb,
  p_reason text,
  p_reverts_change_id uuid default null
)
returns public.timetable_rules
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.set_timetable_rules(p_institution_id, p_rules, p_reason, p_reverts_change_id);
end;
$$;

revoke execute on function public.set_timetable_rules(uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.set_timetable_rules(uuid, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- publish_timetable_version — draft: app.publish_timetable + log; archived:
-- restore (note required), archiving the year's current published version
-- under the same GUC publish_timetable uses. Never deletes a version.
-- ---------------------------------------------------------------------------

create function app.publish_timetable_version(p_version_id uuid, p_note text default null)
returns public.timetable_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_version public.timetable_versions;
  v_previous public.timetable_versions;
  v_kind text;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_version from public.timetable_versions where id = p_version_id for update;
  if v_version.id is null then
    raise exception 'code:not_found' using detail = 'timetable version not found';
  end if;

  if not app.has_role(v_version.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold timetable.manage for this institution';
  end if;

  select * into v_previous from public.timetable_versions
  where institution_id = v_version.institution_id
    and academic_year_id = v_version.academic_year_id
    and status = 'published'
    and id <> v_version.id
  for update;

  if v_version.status = 'draft' then
    v_version := app.publish_timetable(p_version_id);
    v_kind := 'publish';
  elsif v_version.status = 'archived' then
    if v_note is null then
      raise exception 'code:validation_failed' using detail = 'a note is required to restore an earlier version';
    end if;

    perform set_config('app.allow_timetable_publish', 'on', true);

    if v_previous.id is not null then
      update public.timetable_versions set status = 'archived' where id = v_previous.id;
    end if;

    update public.timetable_versions
    set status = 'published', published_at = now(), published_by = v_caller
    where id = p_version_id
    returning * into v_version;

    perform app.audit(
      v_version.institution_id, v_caller, 'timetable.restored', 'timetable_versions', v_version.id,
      jsonb_build_object('status', 'archived'), jsonb_build_object('status', 'published', 'replaced', v_previous.id), null
    );
    v_kind := 'restore';
  else
    raise exception 'code:invalid_state' using detail = 'this version is already the published timetable';
  end if;

  insert into public.timetable_changes (institution_id, version_id, kind, action, before, after, reason, actor_id, actor_name)
  values (
    v_version.institution_id, v_version.id, v_kind, v_kind,
    case when v_previous.id is null then null else jsonb_build_object('versionId', v_previous.id, 'name', v_previous.name) end,
    jsonb_build_object('versionId', v_version.id, 'name', v_version.name),
    left(coalesce(v_note, case when v_kind = 'publish' then 'Published' else 'Restored' end), 500),
    v_caller, app.tt_actor_name(v_caller, v_version.institution_id)
  );

  return v_version;
end;
$$;

revoke execute on function app.publish_timetable_version(uuid, text) from public, anon, authenticated;

create function public.publish_timetable_version(p_version_id uuid, p_note text default null)
returns public.timetable_versions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.publish_timetable_version(p_version_id, p_note);
end;
$$;

revoke execute on function public.publish_timetable_version(uuid, text) from public, anon;
grant execute on function public.publish_timetable_version(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Substitution log trigger + undo_substitution
-- ---------------------------------------------------------------------------

-- security definer: the seed and job runner write substitutions as
-- service_role, which cannot execute the revoked app.tt_* helpers itself.
create function app.log_substitution_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot public.timetable_slots;
  v_original text;
  v_substitute text;
  v_subject text;
  v_kind text;
  v_reason text;
  v_reverts text;
  v_actor uuid := coalesce(app.current_user_id(), new.created_by);
  v_cover jsonb;
  v_regular jsonb;
begin
  select * into v_slot from public.timetable_slots where id = new.slot_id;
  select full_name into v_original from public.staff where id = new.original_teacher_id;
  select full_name into v_substitute from public.staff where id = new.substitute_teacher_id;
  select name into v_subject from public.subjects where id = v_slot.subject_id;
  v_regular := jsonb_build_object('teacherId', new.original_teacher_id, 'teacher', v_original, 'subjectId', v_slot.subject_id, 'subject', v_subject);
  v_cover := jsonb_build_object('teacherId', new.substitute_teacher_id, 'teacher', v_substitute, 'subjectId', v_slot.subject_id, 'subject', v_subject);

  if tg_op = 'INSERT' then
    if new.status <> 'assigned' then
      return new;
    end if;
    v_reason := coalesce(
      nullif(btrim(coalesce(new.note, '')), ''),
      case when new.leave_request_id is not null then format('%s is on leave', v_original) end,
      'Cover assigned'
    );
    insert into public.timetable_changes (
      institution_id, version_id, kind, action, class_section_id, weekday, period_id, on_date, substitution_id,
      teacher_id, prev_teacher_id, label, before, after, reason, actor_id, actor_name
    )
    values (
      new.institution_id, v_slot.version_id, 'substitution', 'cover', v_slot.class_section_id, v_slot.weekday, v_slot.period_id,
      new.date, new.id, new.substitute_teacher_id, new.original_teacher_id,
      app.tt_cell_label(v_slot.class_section_id, v_slot.weekday, v_slot.period_id),
      v_regular, v_cover, left(v_reason, 500), v_actor,
      case when v_actor is null then 'School office' else app.tt_actor_name(v_actor, new.institution_id) end
    );
  elsif old.status = 'assigned' and new.status = 'cancelled' then
    v_kind := coalesce(current_setting('app.tt_change_kind', true), '');
    v_reason := coalesce(current_setting('app.tt_change_reason', true), '');
    v_reverts := coalesce(current_setting('app.tt_reverts_change_id', true), '');
    insert into public.timetable_changes (
      institution_id, version_id, kind, action, class_section_id, weekday, period_id, on_date, substitution_id,
      teacher_id, prev_teacher_id, label, before, after, reason, reverts_change_id, actor_id, actor_name
    )
    values (
      new.institution_id, v_slot.version_id, case when v_kind = '' then 'substitution' else v_kind end, 'uncover',
      v_slot.class_section_id, v_slot.weekday, v_slot.period_id, new.date, new.id,
      new.original_teacher_id, new.substitute_teacher_id,
      app.tt_cell_label(v_slot.class_section_id, v_slot.weekday, v_slot.period_id),
      v_cover, v_regular,
      left(case when v_reason = '' then format('Cover by %s cancelled', v_substitute) else v_reason end, 500),
      nullif(v_reverts, '')::uuid, v_actor,
      case when v_actor is null then 'School office' else app.tt_actor_name(v_actor, new.institution_id) end
    );
  end if;

  return new;
end;
$$;

revoke execute on function app.log_substitution_change() from public, anon, authenticated;

create trigger log_substitution_change
after insert or update of status on public.substitutions
for each row execute function app.log_substitution_change();

create function app.undo_substitution(p_change_id uuid, p_note text default null)
returns public.substitutions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_change public.timetable_changes;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_change from public.timetable_changes where id = p_change_id;
  if v_change.id is null or v_change.substitution_id is null then
    raise exception 'code:not_found' using detail = 'substitution change not found';
  end if;

  if not app.has_role(v_change.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold timetable.manage for this institution';
  end if;

  if v_change.action <> 'cover' then
    raise exception 'code:invalid_state' using detail = 'only an assigned cover can be undone here; assign the substitute again from the cover list';
  end if;

  perform set_config('app.tt_change_kind', 'rollback', true);
  perform set_config('app.tt_change_reason', left('Rollback of: ' || v_change.reason || coalesce(' Note: ' || v_note, ''), 500), true);
  perform set_config('app.tt_reverts_change_id', p_change_id::text, true);

  return app.cancel_substitution(v_change.substitution_id);
exception
  when unique_violation then
    raise exception 'code:conflict' using detail = 'that change has already been undone';
end;
$$;

revoke execute on function app.undo_substitution(uuid, text) from public, anon, authenticated;

create function public.undo_substitution(p_change_id uuid, p_note text default null)
returns public.substitutions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.undo_substitution(p_change_id, p_note);
end;
$$;

revoke execute on function public.undo_substitution(uuid, text) from public, anon;
grant execute on function public.undo_substitution(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- my_section_covers — what a student/guardian may know about a substituted
-- period of their own (or their child's) section on one date: who covers and
-- the subject. Never the note or the leave fact (those stay with managers and
-- the two teachers, see timetable_changes_select); the UI adds a fixed line.
-- ---------------------------------------------------------------------------

create function public.my_section_covers(p_institution_id uuid, p_date date)
returns table (class_section_id uuid, period_id uuid, on_date date, subject text, cover_teacher text)
language sql
stable
security definer
set search_path = ''
as $$
  select ts.class_section_id, s.period_id, s.date, sj.name, st.full_name
  from public.substitutions s
  join public.timetable_slots ts on ts.id = s.slot_id
  join public.timetable_versions v on v.id = ts.version_id and v.status = 'published'
  left join public.subjects sj on sj.id = ts.subject_id
  left join public.staff st on st.id = s.substitute_teacher_id
  where s.institution_id = p_institution_id
    and s.date = p_date
    and s.status = 'assigned'
    and ts.class_section_id = any((select app.my_student_section_ids()));
$$;

revoke execute on function public.my_section_covers(uuid, date) from public, anon;
grant execute on function public.my_section_covers(uuid, date) to authenticated;
