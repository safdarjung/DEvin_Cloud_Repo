-- Features-18 #4: behaviour module (`behaviour`, default on).
--
-- Tables:    public.behaviour_incidents (append-only; void via voided_at)
-- Functions: public.void_behaviour_incident(p_incident_id uuid, p_reason text)
--              -> public.behaviour_incidents (security definer)
--            app.guard_behaviour_incidents() (invoker trigger guard)
--
-- RLS matrix (M = owner/principal/admin):
--   role                 select                          insert                      update/delete
--   M                    all rows of the institution     yes                         void via definer only
--   teacher              students they teach             students they teach         void own report via definer
--                        (app.my_taught_student_ids + active teacher role)
--   guardian / student   own child / self, non-voided    no                          no
--                        (app.my_student_ids)
--   other staff roles    no                              no                          no
--
-- Append-only: no UPDATE/DELETE grant or policy; the only update is
-- public.void_behaviour_incident (guard allows a first void and nothing
-- else); DELETE is blocked by app.block_mutation (demo_reset bypass via
-- app.allow_reset). Points are a signed int (merit +, demerit -); a total is
-- always summed, never stored.
--
-- Reuses (never redefines): app.set_updated_at, app.block_mutation,
-- app.current_user_id, app.is_member, app.has_role, app.my_institution_ids,
-- app.my_taught_student_ids (0035), app.my_student_ids (0020), app.audit,
-- app.module_catalog (0084).

insert into app.module_catalog (key, default_enabled) values ('behaviour', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

create table public.behaviour_incidents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  category text not null check (char_length(category) between 1 and 40),
  severity text not null default 'low' check (severity in ('low', 'medium', 'high')),
  points int not null default 0 check (points between -100 and 100),
  note text check (char_length(note) <= 500),
  occurred_on date not null default ((now() at time zone 'Asia/Kolkata')::date),
  reported_by uuid not null references public.profiles (id),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text check (char_length(void_reason) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint behaviour_incidents_void_triple check (
    (voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)
  )
);

create index behaviour_incidents_institution_occurred_idx on public.behaviour_incidents (institution_id, occurred_on desc);
create index behaviour_incidents_student_occurred_idx on public.behaviour_incidents (student_id, occurred_on desc);

create trigger set_updated_at
before update on public.behaviour_incidents
for each row execute function app.set_updated_at();

-- Invoker guard (lesson 3/5). INSERT: for an end-user JWT, reported_by is
-- forced to the caller and the row always starts un-voided; service role /
-- postgres (seed, demo-reset) may insert historical or voided rows. UPDATE:
-- the only legal move is a first void; every other column is immutable.
create function app.guard_behaviour_incidents()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_trusted boolean;
begin
  if tg_op = 'INSERT' then
    v_is_trusted := (
      coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      or session_user = 'postgres'
    );
    if not v_is_trusted then
      new.reported_by := app.current_user_id();
      new.voided_at := null;
      new.voided_by := null;
      new.void_reason := null;
    end if;
    return new;
  end if;

  if old.voided_at is not null then
    raise exception 'code:invalid_state' using detail = 'incident already voided';
  end if;

  if new.voided_at is null
    or new.institution_id is distinct from old.institution_id
    or new.student_id is distinct from old.student_id
    or new.category is distinct from old.category
    or new.severity is distinct from old.severity
    or new.points is distinct from old.points
    or new.note is distinct from old.note
    or new.occurred_on is distinct from old.occurred_on
    or new.reported_by is distinct from old.reported_by
  then
    raise exception 'code:invalid_state' using detail = 'only a void may be recorded on a behaviour incident';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_behaviour_incidents() from public;

create trigger guard_behaviour_incidents
before insert or update on public.behaviour_incidents
for each row execute function app.guard_behaviour_incidents();

create trigger block_behaviour_incidents_delete
before delete on public.behaviour_incidents
for each row execute function app.block_mutation();

alter table public.behaviour_incidents enable row level security;

create policy behaviour_incidents_select on public.behaviour_incidents
  for select to authenticated
  using (
    behaviour_incidents.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      behaviour_incidents.student_id = any((select app.my_taught_student_ids()))
      and behaviour_incidents.institution_id = any((select app.my_institution_ids(array['teacher'])))
    )
    or (
      behaviour_incidents.voided_at is null
      and behaviour_incidents.student_id = any((select app.my_student_ids()))
    )
  );

create policy behaviour_incidents_insert on public.behaviour_incidents
  for insert to authenticated
  with check (
    (
      behaviour_incidents.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
      or (
        behaviour_incidents.student_id = any((select app.my_taught_student_ids()))
        and behaviour_incidents.institution_id = any((select app.my_institution_ids(array['teacher'])))
      )
    )
    and behaviour_incidents.reported_by = (select app.current_user_id())
    and behaviour_incidents.voided_at is null
    and exists (
      select 1 from public.students s
      where s.id = behaviour_incidents.student_id and s.institution_id = behaviour_incidents.institution_id
    )
  );

-- No UPDATE/DELETE policy: void goes through public.void_behaviour_incident.
revoke all on public.behaviour_incidents from anon, authenticated;
grant select, insert on public.behaviour_incidents to authenticated;

-- ---------------------------------------------------------------------------
-- public.void_behaviour_incident — M voids any incident; a teacher voids only
-- an incident they reported. Non-member: not_found; member without the
-- right: forbidden. Audit carries ids only (no note/reason text, lesson 10).
-- ---------------------------------------------------------------------------

create function public.void_behaviour_incident(p_incident_id uuid, p_reason text)
returns public.behaviour_incidents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_row public.behaviour_incidents;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_row from public.behaviour_incidents where id = p_incident_id for update;
  if v_row.id is null or not app.is_member(v_row.institution_id) then
    raise exception 'code:not_found' using detail = 'incident not found';
  end if;

  if not (
    app.has_role(v_row.institution_id, array['owner', 'principal', 'admin'])
    or (v_row.reported_by = v_uid and app.has_role(v_row.institution_id, array['teacher']))
  ) then
    raise exception 'code:forbidden' using detail = 'caller may not void this incident';
  end if;

  if p_reason is null or char_length(p_reason) not between 1 and 200 then
    raise exception 'code:validation_failed' using detail = 'reason must be 1-200 characters';
  end if;

  if v_row.voided_at is not null then
    raise exception 'code:invalid_state' using detail = 'incident already voided';
  end if;

  update public.behaviour_incidents
  set voided_at = now(), voided_by = v_uid, void_reason = p_reason
  where id = p_incident_id
  returning * into v_row;

  perform app.audit(
    v_row.institution_id, v_uid, 'behaviour.incident.voided', 'behaviour_incidents', v_row.id,
    null, jsonb_build_object('incidentId', v_row.id, 'studentId', v_row.student_id), null
  );

  return v_row;
end;
$$;

revoke execute on function public.void_behaviour_incident(uuid, text) from public, anon;
grant execute on function public.void_behaviour_incident(uuid, text) to authenticated;
