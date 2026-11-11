-- Features-18 #14: alumni module (SPEC §A row 14). A directory of passed-out
-- students derived from the student lifecycle (0076): a student is alumni
-- once `public.promote_students` graduated them, i.e. students.status =
-- 'alumni' with a student_lifecycle_events row of kind 'graduated'
-- (effective_on = the from-year's ends_on). Transfers/withdrawals are not
-- alumni. Holds only student_id plus alumni-only fields; name, class and
-- guardians stay in the people/academics tables.
--
-- Tables
--   alumni_profiles — one per student (unique student_id); batch_year from
--                     the graduation event; contact_email/contact_phone/
--                     occupation/city editable by alumni.manage
--
-- Functions
--   public.sync_alumni(p_institution_id uuid) -> app.sync_alumni: owner/
--     principal/admin; inserts a profile for every graduated student who has
--     none; idempotent; returns the number inserted.
--
-- RLS matrix (alumni.manage = owner/principal/admin; alumni.read =
-- owner/principal/admin/admissions):
--   role                                        | alumni_profiles
--   owner/principal/admin                       | S U (contact_email, contact_phone, occupation, city only)
--   admissions                                  | S
--   accountant/exam_controller/teacher/guardian/student | none
-- No INSERT policy (rows come only from sync_alumni); no DELETE policy.
-- Column grants keep institution_id/student_id/batch_year immutable.

insert into app.module_catalog (key, default_enabled) values ('alumni', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

create table public.alumni_profiles (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  batch_year smallint not null check (batch_year between 1900 and 2200),
  contact_email text check (contact_email is null or (length(contact_email) <= 254 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  contact_phone text check (contact_phone is null or contact_phone ~ '^[6-9][0-9]{9}$'),
  occupation text check (occupation is null or length(occupation) between 1 and 120),
  city text check (city is null or length(city) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alumni_profiles_student_key unique (student_id)
);

create index alumni_profiles_institution_batch_idx on public.alumni_profiles (institution_id, batch_year);

create trigger set_updated_at
before update on public.alumni_profiles
for each row execute function app.set_updated_at();

alter table public.alumni_profiles enable row level security;

create policy alumni_profiles_select on public.alumni_profiles
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'admissions']))));

create policy alumni_profiles_update on public.alumni_profiles
  for update to authenticated
  using (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.alumni_profiles from anon, authenticated;
grant select on public.alumni_profiles to authenticated;
grant update (contact_email, contact_phone, occupation, city) on public.alumni_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- app.sync_alumni / public.sync_alumni
-- ---------------------------------------------------------------------------

create function app.sync_alumni(p_institution_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_inserted int;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold alumni.manage for this institution';
  end if;

  insert into public.alumni_profiles (institution_id, student_id, batch_year)
  select s.institution_id, s.id, extract(year from max(ev.effective_on))::smallint
  from public.students s
  join public.student_lifecycle_events ev
    on ev.student_id = s.id
   and ev.institution_id = s.institution_id
   and ev.kind = 'graduated'
  where s.institution_id = p_institution_id
    and s.status = 'alumni'
  group by s.institution_id, s.id
  on conflict (student_id) do nothing;

  get diagnostics v_inserted = row_count;

  perform app.audit(
    p_institution_id,
    v_caller,
    'alumni.synced',
    'alumni_profiles',
    null,
    null,
    null,
    jsonb_build_object('inserted', v_inserted)
  );

  return v_inserted;
end;
$$;

revoke all on function app.sync_alumni(uuid) from public, anon, authenticated;

create function public.sync_alumni(p_institution_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.sync_alumni(p_institution_id);
end;
$$;

revoke execute on function public.sync_alumni(uuid) from public, anon;
grant execute on function public.sync_alumni(uuid) to authenticated;
