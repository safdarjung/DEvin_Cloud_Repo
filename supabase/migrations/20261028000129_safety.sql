-- Features-18 #21 (SPEC §A3): safety module (`safety`, default on).
-- Emergency alerts, drills and closures; acknowledgements; per-section
-- headcounts.
--
-- Tables
--   safety_alerts            kind, title, message (plain text, never HTML —
--                            consumers render it as text), audience,
--                            status active -> closed (once). Definers only.
--   safety_alert_sections    target sections when audience = 'sections'.
--                            Definer only (written with its alert).
--   safety_acknowledgements  one per (alert, user). Definer only.
--   safety_headcounts        one per (alert, class_section); upserted by
--                            definer while the alert is active.
--   All four: composite (alert_id, institution_id) FKs keep children in the
--   alert's institution; no INSERT/UPDATE/DELETE grant for API roles.
--
-- Enums
--   kind:     emergency | drill | closure
--   audience: all | staff | sections
--   status:   active | closed
--
-- Functions (public, PostgREST-callable, security definer)
--   create_safety_alert(p_institution_id uuid, p_kind text, p_title text, p_message text,
--                       p_audience text, p_section_ids uuid[]) -> public.safety_alerts
--     M only. audience 'sections' needs 1-200 sections of the institution;
--     other audiences take none. At most 10 alerts per institution per hour
--     (code:rate_limited). Enqueues job `notify.safety_alert` {alert_id}
--     (idempotency `safety_alert:<id>`) — notifications are simulated
--     channels (<SimulatedBadge />).
--   close_safety_alert(p_institution_id uuid, p_alert_id uuid) -> public.safety_alerts
--     M only; active -> closed once.
--   acknowledge_safety_alert(p_institution_id uuid, p_alert_id uuid) -> public.safety_acknowledgements
--     any active member in the alert's audience; active alert only; once
--     (second call: code:conflict). Out-of-audience: code:not_found.
--   mark_safety_headcount(p_institution_id uuid, p_alert_id uuid, p_class_section_id uuid,
--                         p_present_count int, p_missing_count int, p_note text)
--                         -> public.safety_headcounts
--     M, or a teacher who teaches the section; active alert only (alert row
--     locked FOR SHARE, so close waits); for audience 'sections' only a
--     targeted section. Upsert on (alert_id, class_section_id).
--
-- RLS matrix (M = owner/principal/admin; S = app.staff_roles(), includes M
-- and teacher; SG = student/guardian):
--   table                    select
--   safety_alerts            S: every alert of the institution
--                            any member: audience 'all'
--                            SG: audience 'sections' with a section of their
--                            own/child's active enrolment
--   safety_alert_sections    S: all rows; SG: rows of their sections
--   safety_acknowledgements  M: all rows; everyone: own rows
--   safety_headcounts        M: all rows; teacher: sections they teach
--                            (app.my_taught_section_ids + teacher role)
--   insert/update/delete: none for anon/authenticated (definers only).
--
-- Seed notes: no column defaults to the signed-in user — seed passes
-- created_by / closed_by / user_id / marked_by explicitly.
--
-- Reuses (never redefines): app.set_updated_at, app.current_user_id,
-- app.is_member, app.has_role, app.staff_roles, app.member_institutions,
-- app.my_institution_ids, app.my_student_section_ids,
-- app.my_taught_section_ids (0020), app.audit, app.enqueue_job (0003),
-- app.module_catalog (0084).

insert into app.module_catalog (key, default_enabled) values ('safety', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- safety_alerts
-- ---------------------------------------------------------------------------

create table public.safety_alerts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  kind text not null check (kind in ('emergency', 'drill', 'closure')),
  title text not null check (char_length(title) between 1 and 200),
  message text not null check (char_length(message) between 1 and 1000),
  audience text not null check (audience in ('all', 'staff', 'sections')),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by uuid not null references public.profiles (id),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_alerts_id_institution_key unique (id, institution_id),
  constraint safety_alerts_closed_state check (
    (status = 'closed') = (closed_at is not null) and (closed_at is null) = (closed_by is null)
  )
);

create index safety_alerts_institution_created_idx on public.safety_alerts (institution_id, created_at desc);

create trigger set_updated_at
before update on public.safety_alerts
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- safety_alert_sections
-- ---------------------------------------------------------------------------

create table public.safety_alert_sections (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  alert_id uuid not null,
  class_section_id uuid not null references public.class_sections (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_alert_sections_alert_fkey
    foreign key (alert_id, institution_id) references public.safety_alerts (id, institution_id),
  constraint safety_alert_sections_alert_section_key unique (alert_id, class_section_id)
);

create index safety_alert_sections_section_idx on public.safety_alert_sections (class_section_id);
create index safety_alert_sections_institution_idx on public.safety_alert_sections (institution_id);

create trigger set_updated_at
before update on public.safety_alert_sections
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- safety_acknowledgements
-- ---------------------------------------------------------------------------

create table public.safety_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  alert_id uuid not null,
  user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_acknowledgements_alert_fkey
    foreign key (alert_id, institution_id) references public.safety_alerts (id, institution_id),
  constraint safety_acknowledgements_alert_user_key unique (alert_id, user_id)
);

create index safety_acknowledgements_user_idx on public.safety_acknowledgements (user_id);
create index safety_acknowledgements_institution_idx on public.safety_acknowledgements (institution_id);

create trigger set_updated_at
before update on public.safety_acknowledgements
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- safety_headcounts
-- ---------------------------------------------------------------------------

create table public.safety_headcounts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  alert_id uuid not null,
  class_section_id uuid not null references public.class_sections (id),
  present_count int not null check (present_count between 0 and 1000),
  missing_count int not null check (missing_count between 0 and 1000),
  note text check (char_length(note) between 1 and 200),
  marked_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_headcounts_alert_fkey
    foreign key (alert_id, institution_id) references public.safety_alerts (id, institution_id),
  constraint safety_headcounts_alert_section_key unique (alert_id, class_section_id)
);

create index safety_headcounts_section_idx on public.safety_headcounts (class_section_id);
create index safety_headcounts_institution_idx on public.safety_headcounts (institution_id);

create trigger set_updated_at
before update on public.safety_headcounts
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS + grants. Policies never reference safety_alerts from a child table
-- (no policy recursion); the alerts 'sections' branch reads the
-- RLS-filtered safety_alert_sections.
-- ---------------------------------------------------------------------------

alter table public.safety_alerts enable row level security;
alter table public.safety_alert_sections enable row level security;
alter table public.safety_acknowledgements enable row level security;
alter table public.safety_headcounts enable row level security;

create policy safety_alerts_select on public.safety_alerts
  for select to authenticated
  using (
    safety_alerts.institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or (
      safety_alerts.audience = 'all'
      and safety_alerts.institution_id = any((select app.member_institutions()))
    )
    or (
      safety_alerts.audience = 'sections'
      and safety_alerts.institution_id = any((select app.my_institution_ids(array['student', 'guardian'])))
      and exists (
        select 1 from public.safety_alert_sections sas
        where sas.alert_id = safety_alerts.id
          and sas.class_section_id = any((select app.my_student_section_ids()))
      )
    )
  );

create policy safety_alert_sections_select on public.safety_alert_sections
  for select to authenticated
  using (
    safety_alert_sections.institution_id = any((select app.my_institution_ids(app.staff_roles())))
    or (
      safety_alert_sections.institution_id = any((select app.my_institution_ids(array['student', 'guardian'])))
      and safety_alert_sections.class_section_id = any((select app.my_student_section_ids()))
    )
  );

create policy safety_acknowledgements_select on public.safety_acknowledgements
  for select to authenticated
  using (
    safety_acknowledgements.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or safety_acknowledgements.user_id = (select app.current_user_id())
  );

create policy safety_headcounts_select on public.safety_headcounts
  for select to authenticated
  using (
    safety_headcounts.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      safety_headcounts.class_section_id = any((select app.my_taught_section_ids()))
      and safety_headcounts.institution_id = any((select app.my_institution_ids(array['teacher'])))
    )
  );

revoke all on public.safety_alerts from anon, authenticated;
revoke all on public.safety_alert_sections from anon, authenticated;
revoke all on public.safety_acknowledgements from anon, authenticated;
revoke all on public.safety_headcounts from anon, authenticated;
grant select on public.safety_alerts to authenticated;
grant select on public.safety_alert_sections to authenticated;
grant select on public.safety_acknowledgements to authenticated;
grant select on public.safety_headcounts to authenticated;

-- ---------------------------------------------------------------------------
-- public.create_safety_alert — M only. Audit carries ids + kind/audience,
-- never the message text (lesson 10).
-- ---------------------------------------------------------------------------

create function public.create_safety_alert(
  p_institution_id uuid,
  p_kind text,
  p_title text,
  p_message text,
  p_audience text,
  p_section_ids uuid[]
)
returns public.safety_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_section_count int := coalesce(cardinality(p_section_ids), 0);
  v_recent int;
  v_row public.safety_alerts;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold safety.alert.send for this institution';
  end if;

  if p_kind is null or p_kind not in ('emergency', 'drill', 'closure') then
    raise exception 'code:validation_failed' using detail = 'kind must be emergency, drill or closure';
  end if;

  if p_audience is null or p_audience not in ('all', 'staff', 'sections') then
    raise exception 'code:validation_failed' using detail = 'audience must be all, staff or sections';
  end if;

  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'code:validation_failed' using detail = 'title must be 1-200 characters';
  end if;

  if p_message is null or char_length(btrim(p_message)) not between 1 and 1000 then
    raise exception 'code:validation_failed' using detail = 'message must be 1-1000 characters';
  end if;

  if p_audience = 'sections' then
    if v_section_count not between 1 and 200 or array_position(p_section_ids, null) is not null then
      raise exception 'code:validation_failed' using detail = 'sections audience needs 1-200 sections';
    end if;
    if (
      select count(*) from public.class_sections cs
      where cs.id = any(p_section_ids) and cs.institution_id = p_institution_id
    ) <> (select count(distinct x) from unnest(p_section_ids) x) then
      raise exception 'code:validation_failed' using detail = 'every section must belong to this institution';
    end if;
  elsif v_section_count > 0 then
    raise exception 'code:validation_failed' using detail = 'sections are only allowed for the sections audience';
  end if;

  -- Serialise one institution's creates so the hourly cap holds.
  perform pg_advisory_xact_lock(hashtextextended('safety_alert:' || p_institution_id::text, 0));

  select count(*) into v_recent
  from public.safety_alerts a
  where a.institution_id = p_institution_id
    and a.created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    raise exception 'code:rate_limited' using detail = 'too many safety alerts in the last hour';
  end if;

  insert into public.safety_alerts (institution_id, kind, title, message, audience, created_by)
  values (p_institution_id, p_kind, btrim(p_title), btrim(p_message), p_audience, v_uid)
  returning * into v_row;

  if p_audience = 'sections' then
    insert into public.safety_alert_sections (institution_id, alert_id, class_section_id)
    select distinct p_institution_id, v_row.id, x
    from unnest(p_section_ids) x;
  end if;

  perform app.enqueue_job(
    p_institution_id,
    'notify.safety_alert',
    jsonb_build_object('alert_id', v_row.id),
    'safety_alert:' || v_row.id::text
  );

  perform app.audit(
    p_institution_id, v_uid, 'safety.alert.created', 'safety_alerts', v_row.id,
    null,
    jsonb_build_object('alert_id', v_row.id, 'kind', p_kind, 'audience', p_audience),
    null
  );

  return v_row;
end;
$$;

revoke execute on function public.create_safety_alert(uuid, text, text, text, text, uuid[]) from public, anon;
grant execute on function public.create_safety_alert(uuid, text, text, text, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- public.close_safety_alert — M only; active -> closed once.
-- ---------------------------------------------------------------------------

create function public.close_safety_alert(p_institution_id uuid, p_alert_id uuid)
returns public.safety_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_row public.safety_alerts;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold safety.alert.send for this institution';
  end if;

  select * into v_row
  from public.safety_alerts a
  where a.id = p_alert_id and a.institution_id = p_institution_id
  for update;

  if v_row.id is null then
    raise exception 'code:not_found' using detail = 'alert not found';
  end if;

  if v_row.status <> 'active' then
    raise exception 'code:invalid_state' using detail = 'alert already closed';
  end if;

  update public.safety_alerts
  set status = 'closed', closed_at = now(), closed_by = v_uid
  where id = p_alert_id
  returning * into v_row;

  perform app.audit(
    p_institution_id, v_uid, 'safety.alert.closed', 'safety_alerts', v_row.id,
    jsonb_build_object('status', 'active'), jsonb_build_object('status', 'closed'), null
  );

  return v_row;
end;
$$;

revoke execute on function public.close_safety_alert(uuid, uuid) from public, anon;
grant execute on function public.close_safety_alert(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.acknowledge_safety_alert — any active member in the alert's
-- audience (same rule as safety_alerts_select), active alert only, once.
-- Out-of-audience callers get not_found (the alert is invisible to them).
-- Not audited: the acknowledgement row is the record.
-- ---------------------------------------------------------------------------

create function public.acknowledge_safety_alert(p_institution_id uuid, p_alert_id uuid)
returns public.safety_acknowledgements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_alert public.safety_alerts;
  v_row public.safety_acknowledgements;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.is_member(p_institution_id) then
    raise exception 'code:forbidden' using detail = 'caller is not a member of this institution';
  end if;

  select * into v_alert
  from public.safety_alerts a
  where a.id = p_alert_id and a.institution_id = p_institution_id;

  if v_alert.id is null or not (
    v_alert.audience = 'all'
    or app.has_role(p_institution_id, app.staff_roles())
    or (
      v_alert.audience = 'sections'
      and app.has_role(p_institution_id, array['student', 'guardian'])
      and exists (
        select 1 from public.safety_alert_sections sas
        where sas.alert_id = v_alert.id
          and sas.class_section_id in (select app.my_student_section_ids())
      )
    )
  ) then
    raise exception 'code:not_found' using detail = 'alert not found';
  end if;

  if v_alert.status <> 'active' then
    raise exception 'code:invalid_state' using detail = 'alert is closed';
  end if;

  insert into public.safety_acknowledgements (institution_id, alert_id, user_id)
  values (p_institution_id, p_alert_id, v_uid)
  on conflict (alert_id, user_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    raise exception 'code:conflict' using detail = 'alert already acknowledged';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.acknowledge_safety_alert(uuid, uuid) from public, anon;
grant execute on function public.acknowledge_safety_alert(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.mark_safety_headcount — M, or a teacher of the section; only while
-- the alert is active. FOR SHARE on the alert row: concurrent marks proceed,
-- close_safety_alert (FOR UPDATE) waits for them.
-- ---------------------------------------------------------------------------

create function public.mark_safety_headcount(
  p_institution_id uuid,
  p_alert_id uuid,
  p_class_section_id uuid,
  p_present_count int,
  p_missing_count int,
  p_note text
)
returns public.safety_headcounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_alert public.safety_alerts;
  v_note text := nullif(btrim(p_note), '');
  v_row public.safety_headcounts;
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin', 'teacher']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold safety.headcount.mark for this institution';
  end if;

  select * into v_alert
  from public.safety_alerts a
  where a.id = p_alert_id and a.institution_id = p_institution_id
  for share;

  if v_alert.id is null then
    raise exception 'code:not_found' using detail = 'alert not found';
  end if;

  if not exists (
    select 1 from public.class_sections cs
    where cs.id = p_class_section_id and cs.institution_id = p_institution_id
  ) then
    raise exception 'code:not_found' using detail = 'section not found';
  end if;

  if not (
    app.has_role(p_institution_id, array['owner', 'principal', 'admin'])
    or p_class_section_id in (select app.my_taught_section_ids())
  ) then
    raise exception 'code:forbidden' using detail = 'caller does not teach this section';
  end if;

  if v_alert.status <> 'active' then
    raise exception 'code:invalid_state' using detail = 'alert is closed';
  end if;

  if v_alert.audience = 'sections' and not exists (
    select 1 from public.safety_alert_sections sas
    where sas.alert_id = p_alert_id and sas.class_section_id = p_class_section_id
  ) then
    raise exception 'code:validation_failed' using detail = 'section is not targeted by this alert';
  end if;

  if p_present_count is null or p_missing_count is null
    or p_present_count not between 0 and 1000 or p_missing_count not between 0 and 1000
  then
    raise exception 'code:validation_failed' using detail = 'counts must be 0-1000';
  end if;

  if char_length(v_note) > 200 then
    raise exception 'code:validation_failed' using detail = 'note must be at most 200 characters';
  end if;

  insert into public.safety_headcounts (
    institution_id, alert_id, class_section_id, present_count, missing_count, note, marked_by
  )
  values (p_institution_id, p_alert_id, p_class_section_id, p_present_count, p_missing_count, v_note, v_uid)
  on conflict (alert_id, class_section_id) do update
    set present_count = excluded.present_count,
        missing_count = excluded.missing_count,
        note = excluded.note,
        marked_by = excluded.marked_by
  returning * into v_row;

  perform app.audit(
    p_institution_id, v_uid, 'safety.headcount.marked', 'safety_headcounts', v_row.id,
    null,
    jsonb_build_object(
      'alert_id', p_alert_id, 'class_section_id', p_class_section_id,
      'present_count', p_present_count, 'missing_count', p_missing_count
    ),
    null
  );

  return v_row;
end;
$$;

revoke execute on function public.mark_safety_headcount(uuid, uuid, uuid, int, int, text) from public, anon;
grant execute on function public.mark_safety_headcount(uuid, uuid, uuid, int, int, text) to authenticated;
