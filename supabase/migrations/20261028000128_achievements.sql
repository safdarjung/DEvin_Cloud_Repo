-- Features-18 #20 (SPEC §A3): achievements module (`achievements`, default on).
-- Student portfolio of achievements; printable per student (UI).
--
-- Tables:    public.achievements (append-only; verify and void via definers)
-- Functions: public.verify_achievement(p_institution_id uuid, p_achievement_id uuid)
--              -> public.achievements (security definer; owner/principal/admin)
--            public.void_achievement(p_institution_id uuid, p_achievement_id uuid, p_reason text)
--              -> public.achievements (security definer; M any, teacher own unverified)
--            app.guard_achievements() (invoker trigger guard)
--
-- Enums
--   category: academic | sports | arts | leadership | service | other
--   level:    school | district | state | national | international
--
-- RLS matrix (M = owner/principal/admin):
--   role                 select                          insert                      update/delete
--   M                    all rows of the institution     yes                         verify/void via definer only
--   teacher              students they teach             students they teach         void own unverified via definer;
--                        (app.my_taught_student_ids + active teacher role)           never verify
--   guardian / student   own child / self, non-voided    no                          no
--                        (app.my_student_ids)
--   other staff roles    no                              no                          no
--
-- Append-only: no UPDATE/DELETE grant or policy. The only updates are a first
-- verify (public.verify_achievement) and a first void
-- (public.void_achievement); app.guard_achievements rejects anything else.
-- DELETE is blocked by app.block_mutation (demo_reset bypass via
-- app.allow_reset). A correction is a void plus a new row.
--
-- INSERT is column-scoped: clients name only institution_id, student_id,
-- title, category, level, position, event_date, description. recorded_by
-- defaults to the signed-in user; verified_* / voided_* start null.
--
-- Seed notes: recorded_by defaults to app.current_user_id(), which is null
-- under the service role — seed must pass recorded_by (and verified_by /
-- verified_at for verified rows) explicitly.
--
-- Reuses (never redefines): app.set_updated_at, app.block_mutation,
-- app.current_user_id, app.has_role, app.my_institution_ids,
-- app.my_taught_student_ids (0035), app.my_student_ids (0020), app.audit,
-- app.module_catalog (0084).

insert into app.module_catalog (key, default_enabled) values ('achievements', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  title text not null check (char_length(title) between 1 and 200),
  category text not null check (category in ('academic', 'sports', 'arts', 'leadership', 'service', 'other')),
  level text not null check (level in ('school', 'district', 'state', 'national', 'international')),
  position text check (char_length(position) between 1 and 60),
  event_date date not null,
  description text check (char_length(description) <= 1000),
  recorded_by uuid not null default app.current_user_id() references public.profiles (id),
  verified_at timestamptz,
  verified_by uuid references public.profiles (id),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text check (char_length(void_reason) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint achievements_verify_pair check ((verified_at is null) = (verified_by is null)),
  constraint achievements_void_triple check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

create index achievements_institution_event_idx on public.achievements (institution_id, event_date desc);
create index achievements_student_event_idx on public.achievements (student_id, event_date desc);

create trigger set_updated_at
before update on public.achievements
for each row execute function app.set_updated_at();

-- Invoker guard: the only legal updates are a first verify (unvoided row) or
-- a first void (verification untouched); every content column is immutable.
create function app.guard_achievements()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'code:invalid_state' using detail = 'achievement already voided';
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.student_id is distinct from old.student_id
    or new.title is distinct from old.title
    or new.category is distinct from old.category
    or new.level is distinct from old.level
    or new.position is distinct from old.position
    or new.event_date is distinct from old.event_date
    or new.description is distinct from old.description
    or new.recorded_by is distinct from old.recorded_by
    or not (
      -- first verify
      (old.verified_at is null and new.verified_at is not null and new.voided_at is null)
      -- first void, verification unchanged
      or (
        new.voided_at is not null
        and new.verified_at is not distinct from old.verified_at
        and new.verified_by is not distinct from old.verified_by
      )
    )
  then
    raise exception 'code:invalid_state' using detail = 'only a verify or a void may be recorded on an achievement';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_achievements() from public;

create trigger guard_achievements
before update on public.achievements
for each row execute function app.guard_achievements();

create trigger block_achievements_delete
before delete on public.achievements
for each row execute function app.block_mutation();

alter table public.achievements enable row level security;

create policy achievements_select on public.achievements
  for select to authenticated
  using (
    achievements.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      achievements.student_id = any((select app.my_taught_student_ids()))
      and achievements.institution_id = any((select app.my_institution_ids(array['teacher'])))
    )
    or (
      achievements.voided_at is null
      and achievements.student_id = any((select app.my_student_ids()))
    )
  );

create policy achievements_insert on public.achievements
  for insert to authenticated
  with check (
    (
      achievements.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or (
        achievements.student_id = any((select app.my_taught_student_ids()))
        and achievements.institution_id = any((select app.my_institution_ids(array['teacher'])))
      )
    )
    and achievements.recorded_by = (select app.current_user_id())
    and achievements.verified_at is null
    and achievements.voided_at is null
    and exists (
      select 1 from public.students s
      where s.id = achievements.student_id and s.institution_id = achievements.institution_id
    )
  );

-- No UPDATE/DELETE policy: verify/void go through the definers below.
revoke all on public.achievements from anon, authenticated;
grant select on public.achievements to authenticated;
grant insert (institution_id, student_id, title, category, level, position, event_date, description)
  on public.achievements to authenticated;

-- ---------------------------------------------------------------------------
-- public.verify_achievement — M only (a teacher cannot verify). Non-M:
-- forbidden; row not in the institution: not_found. Audit carries ids only.
-- ---------------------------------------------------------------------------

create function public.verify_achievement(p_institution_id uuid, p_achievement_id uuid)
returns public.achievements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_row public.achievements;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold achievement.verify for this institution';
  end if;

  select * into v_row
  from public.achievements a
  where a.id = p_achievement_id and a.institution_id = p_institution_id
  for update;

  if v_row.id is null then
    raise exception 'code:not_found' using detail = 'achievement not found';
  end if;

  if v_row.voided_at is not null then
    raise exception 'code:invalid_state' using detail = 'achievement is voided';
  end if;

  if v_row.verified_at is not null then
    raise exception 'code:invalid_state' using detail = 'achievement already verified';
  end if;

  update public.achievements
  set verified_at = now(), verified_by = v_uid
  where id = p_achievement_id
  returning * into v_row;

  perform app.audit(
    p_institution_id, v_uid, 'achievement.verified', 'achievements', v_row.id,
    null, jsonb_build_object('achievementId', v_row.id, 'studentId', v_row.student_id), null
  );

  return v_row;
end;
$$;

revoke execute on function public.verify_achievement(uuid, uuid) from public, anon;
grant execute on function public.verify_achievement(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.void_achievement — M voids any achievement; a teacher voids only an
-- unverified achievement they recorded. Audit carries ids only (no reason
-- text, lesson 10).
-- ---------------------------------------------------------------------------

create function public.void_achievement(p_institution_id uuid, p_achievement_id uuid, p_reason text)
returns public.achievements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_row public.achievements;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin', 'teacher']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold achievement.write for this institution';
  end if;

  select * into v_row
  from public.achievements a
  where a.id = p_achievement_id and a.institution_id = p_institution_id
  for update;

  if v_row.id is null then
    raise exception 'code:not_found' using detail = 'achievement not found';
  end if;

  if not (
    app.has_role(p_institution_id, array['owner', 'principal', 'admin'])
    or (v_row.recorded_by = v_uid and v_row.verified_at is null)
  ) then
    raise exception 'code:forbidden' using detail = 'caller may not void this achievement';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 200 then
    raise exception 'code:validation_failed' using detail = 'reason must be 1-200 characters';
  end if;

  if v_row.voided_at is not null then
    raise exception 'code:invalid_state' using detail = 'achievement already voided';
  end if;

  update public.achievements
  set voided_at = now(), voided_by = v_uid, void_reason = btrim(p_reason)
  where id = p_achievement_id
  returning * into v_row;

  perform app.audit(
    p_institution_id, v_uid, 'achievement.voided', 'achievements', v_row.id,
    null, jsonb_build_object('achievementId', v_row.id, 'studentId', v_row.student_id), null
  );

  return v_row;
end;
$$;

revoke execute on function public.void_achievement(uuid, uuid, text) from public, anon;
grant execute on function public.void_achievement(uuid, uuid, text) to authenticated;
