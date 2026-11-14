-- 0155 teacher_profiles — what a teacher fills in when they first sign in
-- (qualifications, the subjects and classes they can teach, experience), and
-- the school's rule for the highest class each qualification level may teach.
--
-- Owner request (2026-11-14): teachers fill a form on first sign-in; the office
-- gets teachers sorted by qualification (e.g. Masters for class X, BA for
-- classes I-III) to share classes out; principals and admins configure it.

-- ---------------------------------------------------------------------------
-- staff: teaching-profile columns. Written only by save_own_teacher_profile
-- (the teacher's own row) or by the office under the existing staff_update
-- policy (owner/principal/admin). Subject and grade ids are arrays (a
-- preference list, not an assignment: subject_assignments stays the truth for
-- who teaches what); the save function checks every id belongs to the school.
-- ---------------------------------------------------------------------------

alter table public.staff
  add column qualifications jsonb not null default '[]'::jsonb check (jsonb_typeof(qualifications) = 'array'),
  add column highest_qualification text check (highest_qualification in ('diploma', 'bachelors', 'masters', 'doctorate')),
  add column can_teach_subject_ids uuid[] not null default '{}',
  add column can_teach_grade_ids uuid[] not null default '{}',
  add column experience_years int check (experience_years between 0 and 60),
  add column onboarded_at timestamptz;

comment on column public.staff.qualifications is
  '0155: [{level: diploma|bachelors|masters|doctorate, degree, subject?, year?}], newest first as entered.';
comment on column public.staff.onboarded_at is
  '0155: set the first time the person saves their teaching profile; null shows them the "finish your profile" prompt.';

-- ---------------------------------------------------------------------------
-- The caller's own staff row, found through their membership (staff.user_id is
-- often unset, so staff_select would hide a teacher's own row from them).
-- ---------------------------------------------------------------------------

create function app.caller_staff_id(p_institution_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.staff_id
  from public.memberships m
  where m.institution_id = p_institution_id
    and m.user_id = app.current_user_id()
    and m.status = 'active'
    and m.staff_id is not null
  limit 1;
$$;

revoke execute on function app.caller_staff_id(uuid) from public, anon, authenticated;

create function public.my_teacher_profile(p_institution_id uuid)
returns table (
  staff_id uuid,
  full_name text,
  qualifications jsonb,
  highest_qualification text,
  can_teach_subject_ids uuid[],
  can_teach_grade_ids uuid[],
  experience_years int,
  onboarded_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.full_name, s.qualifications, s.highest_qualification, s.can_teach_subject_ids, s.can_teach_grade_ids, s.experience_years, s.onboarded_at
  from public.staff s
  where s.id = app.caller_staff_id(p_institution_id)
    and s.institution_id = p_institution_id;
$$;

revoke execute on function public.my_teacher_profile(uuid) from public, anon;
grant execute on function public.my_teacher_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.save_own_teacher_profile — the caller's own staff row only. The
-- action validates shapes with Zod first; this re-checks what matters for
-- integrity: array shape and size, known levels, ids of this school.
-- highest_qualification is derived here, never sent by the client.
-- ---------------------------------------------------------------------------

create function public.save_own_teacher_profile(
  p_institution_id uuid,
  p_qualifications jsonb,
  p_subject_ids uuid[],
  p_grade_ids uuid[],
  p_experience_years int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := app.caller_staff_id(p_institution_id);
  v_levels text[] := array['diploma', 'bachelors', 'masters', 'doctorate'];
  v_highest text;
begin
  if v_staff is null then
    raise exception 'code:forbidden' using detail = 'only a staff member can save their own teaching profile';
  end if;

  if jsonb_typeof(p_qualifications) <> 'array'
    or jsonb_array_length(p_qualifications) > 10
    or exists (
      select 1 from jsonb_array_elements(p_qualifications) q
      where jsonb_typeof(q) <> 'object' or not ((q ->> 'level') = any (v_levels)) or coalesce(length(q ->> 'degree'), 0) not between 1 and 80
    )
  then
    raise exception 'code:validation_failed' using detail = 'qualifications must be up to 10 entries, each with a known level and a degree';
  end if;

  if coalesce(array_length(p_subject_ids, 1), 0) > 40 or coalesce(array_length(p_grade_ids, 1), 0) > 20
    or exists (select 1 from unnest(coalesce(p_subject_ids, '{}')) i where not exists (select 1 from public.subjects s where s.id = i and s.institution_id = p_institution_id))
    or exists (select 1 from unnest(coalesce(p_grade_ids, '{}')) i where not exists (select 1 from public.grades g where g.id = i and g.institution_id = p_institution_id))
  then
    raise exception 'code:validation_failed' using detail = 'subjects and classes must belong to this school';
  end if;

  select q ->> 'level' into v_highest
  from jsonb_array_elements(p_qualifications) q
  order by array_position(v_levels, q ->> 'level') desc
  limit 1;

  update public.staff
  set qualifications = p_qualifications,
      highest_qualification = v_highest,
      can_teach_subject_ids = coalesce(p_subject_ids, '{}'),
      can_teach_grade_ids = coalesce(p_grade_ids, '{}'),
      experience_years = p_experience_years,
      onboarded_at = coalesce(onboarded_at, now())
  where id = v_staff
    and institution_id = p_institution_id;

  return jsonb_build_object('staff_id', v_staff, 'highest_qualification', v_highest);
end;
$$;

revoke execute on function public.save_own_teacher_profile(uuid, jsonb, uuid[], uuid[], int) from public, anon;
grant execute on function public.save_own_teacher_profile(uuid, jsonb, uuid[], uuid[], int) to authenticated;

-- ---------------------------------------------------------------------------
-- patch_institution_settings (0144) — adds the `staff` key (the
-- qualification rules: settings.staff.max_grade_by_level). Same body
-- otherwise.
-- ---------------------------------------------------------------------------

create or replace function public.patch_institution_settings(p_institution_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb;
begin
  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold institution.settings.manage for this institution';
  end if;

  if jsonb_typeof(p_patch) is distinct from 'object'
    or exists (
      select 1 from jsonb_each(p_patch) e
      where e.key not in ('modules', 'features', 'ai_roles', 'branding', 'setup', 'staff')
        or jsonb_typeof(e.value) <> 'object'
    )
  then
    raise exception 'code:validation_failed' using detail = 'only modules, features, ai_roles, branding, setup and staff can be patched, each as an object';
  end if;

  update public.institutions
  set settings = app.jsonb_merge_patch(settings, p_patch)
  where id = p_institution_id
  returning settings into v_settings;

  return v_settings;
end;
$$;
