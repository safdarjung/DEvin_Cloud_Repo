-- M06-T2: announcements, announcement_audiences, notification_preferences,
-- publish_announcement RPC (06 M06-tasks.md header rulings).
--
-- announcements/announcement_audiences are managers-only (owner/principal/
-- admin = announcement.manage, 07 §2.2): recipients never read these
-- tables directly, they get a `notifications` row instead (fan-out lives in
-- M06-T3's notify.announcement job handler, not here) — so a guardian
-- cannot read a staff-only announcement over PostgREST by construction
-- (lesson 1).
--
-- Status machine: a draft is freely edited by its managers; once published
-- it is immutable. `app.guard_announcements_update` (plain plpgsql, no
-- table access, so nothing for the planner to inline into a policy, same
-- shape as 0067's guard) blocks any edit of a non-draft row and any direct
-- status change; only `public.publish_announcement` may move draft ->
-- published, under the transaction-local GUC `app.allow_announcement_publish`
-- (same shape as 0010's `app.allow_publish`). Audience rows are writable
-- only while the parent announcement is still a draft (checked in the
-- audience table's own `with check`, not the guard trigger).
--
-- publish_announcement (app.* core + public.* thin wrapper, same split as
-- 0009's publish_exam_results/0010's publish_page): role check, draft-only,
-- >= 1 audience, flips status, enqueues exactly one `notify.announcement`
-- job with payload `{announcement_id}` built from the row in SQL (lesson
-- 3), idempotency key `announcement:<id>` so a retried call never double
-- enqueues, and an audit row.

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  title text not null check (length(title) between 1 and 120),
  body text not null check (length(body) between 1 and 4000),
  category text not null default 'general' check (category in ('general', 'academic', 'event', 'holiday', 'fees', 'emergency')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index announcements_institution_status_idx on public.announcements (institution_id, status);

create trigger set_updated_at
before update on public.announcements
for each row execute function app.set_updated_at();

create function app.guard_announcements_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return new;
  end if;

  if current_setting('app.allow_announcement_publish', true) = 'on' then
    -- Only app.publish_announcement runs with this GUC on, and only to move
    -- draft -> published while stamping published_at/published_by; every
    -- other column must stay exactly as it was.
    if old.status is distinct from 'draft' or new.status is distinct from 'published' then
      raise exception 'code:forbidden' using detail = 'app.allow_announcement_publish only moves a draft to published';
    end if;

    if new.title is distinct from old.title
      or new.body is distinct from old.body
      or new.category is distinct from old.category
      or new.institution_id is distinct from old.institution_id
      or new.created_by is distinct from old.created_by
    then
      raise exception 'code:forbidden' using detail = 'publish may only set status, published_at, and published_by';
    end if;

    return new;
  end if;

  if old.status is distinct from 'draft' then
    raise exception 'code:invalid_state' using detail = 'a published announcement is immutable';
  end if;

  if new.status is distinct from old.status then
    raise exception 'code:forbidden' using detail = 'status only changes via publish_announcement';
  end if;

  return new;
end;
$$;

create trigger guard_announcements_update
before update on public.announcements
for each row execute function app.guard_announcements_update();

alter table public.announcements enable row level security;

create policy announcements_select on public.announcements
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy announcements_insert on public.announcements
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and created_by = app.current_user_id()
    and status = 'draft'
    and published_at is null
    and published_by is null
  );

create policy announcements_update on public.announcements
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- ---------------------------------------------------------------------------
-- announcement_audiences
-- ---------------------------------------------------------------------------

create table public.announcement_audiences (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements (id),
  institution_id uuid not null references public.institutions (id),
  audience_type text not null check (audience_type in ('school', 'role', 'grade', 'section')),
  role text check (role in (
    'owner', 'principal', 'admin', 'admissions', 'accountant',
    'exam_controller', 'teacher', 'student', 'guardian'
  )),
  grade_id uuid references public.grades (id),
  class_section_id uuid references public.class_sections (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (audience_type = 'school' and role is null and grade_id is null and class_section_id is null)
    or (audience_type = 'role' and role is not null and grade_id is null and class_section_id is null)
    or (audience_type = 'grade' and grade_id is not null and role is null and class_section_id is null)
    or (audience_type = 'section' and class_section_id is not null and role is null and grade_id is null)
  )
);

create index announcement_audiences_announcement_idx on public.announcement_audiences (announcement_id);

create trigger set_updated_at
before update on public.announcement_audiences
for each row execute function app.set_updated_at();

alter table public.announcement_audiences enable row level security;

create policy announcement_audiences_select on public.announcement_audiences
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- INSERT/UPDATE both require the parent announcement to still be a draft,
-- and to belong to the SAME institution as this row (lesson 2) — the one
-- `exists` below does both jobs at once.
create policy announcement_audiences_insert on public.announcement_audiences
  for insert to authenticated
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.announcements a
      where a.id = announcement_audiences.announcement_id
        and a.institution_id = announcement_audiences.institution_id
        and a.status = 'draft'
    )
    and (
      grade_id is null
      or exists (select 1 from public.grades g where g.id = announcement_audiences.grade_id and g.institution_id = announcement_audiences.institution_id)
    )
    and (
      class_section_id is null
      or exists (select 1 from public.class_sections cs where cs.id = announcement_audiences.class_section_id and cs.institution_id = announcement_audiences.institution_id)
    )
  );

create policy announcement_audiences_update on public.announcement_audiences
  for update to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (
    app.has_role(institution_id, array['owner', 'principal', 'admin'])
    and exists (
      select 1 from public.announcements a
      where a.id = announcement_audiences.announcement_id
        and a.institution_id = announcement_audiences.institution_id
        and a.status = 'draft'
    )
    and (
      grade_id is null
      or exists (select 1 from public.grades g where g.id = announcement_audiences.grade_id and g.institution_id = announcement_audiences.institution_id)
    )
    and (
      class_section_id is null
      or exists (select 1 from public.class_sections cs where cs.id = announcement_audiences.class_section_id and cs.institution_id = announcement_audiences.institution_id)
    )
  );

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------

create table public.notification_preferences (
  user_id uuid not null references public.profiles (id),
  institution_id uuid not null references public.institutions (id),
  category text not null check (category in ('attendance', 'academic', 'admissions', 'announcement')),
  channel text not null check (channel in ('sms', 'email')),
  enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, institution_id, category, channel)
);

create trigger set_updated_at
before update on public.notification_preferences
for each row execute function app.set_updated_at();

alter table public.notification_preferences enable row level security;

create policy notification_preferences_select on public.notification_preferences
  for select to authenticated
  using (user_id = app.current_user_id() and app.is_member(institution_id));

create policy notification_preferences_insert on public.notification_preferences
  for insert to authenticated
  with check (user_id = app.current_user_id() and app.is_member(institution_id));

create policy notification_preferences_update on public.notification_preferences
  for update to authenticated
  using (user_id = app.current_user_id() and app.is_member(institution_id))
  with check (user_id = app.current_user_id() and app.is_member(institution_id));

-- ---------------------------------------------------------------------------
-- app.publish_announcement / public.publish_announcement (06 rulings,
-- 07 §2.2 announcement.manage, §4). Same split as 0009's
-- publish_exam_results / 0010's publish_page: the real logic lives in
-- `app` (not PostgREST-exposed, revoked even from `authenticated`);
-- `public.publish_announcement` is the thin exposed wrapper, its own role
-- check done again inside app.publish_announcement.
-- ---------------------------------------------------------------------------

create function app.publish_announcement(p_announcement_id uuid)
returns public.announcements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_announcement public.announcements;
  v_audience_count int;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_announcement from public.announcements where id = p_announcement_id for update;
  if v_announcement.id is null then
    raise exception 'code:not_found' using detail = 'announcement not found';
  end if;

  if not app.has_role(v_announcement.institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold announcement.manage for this institution';
  end if;

  if v_announcement.status <> 'draft' then
    raise exception 'code:invalid_state' using detail = format('announcement must be draft to publish; current status is %s', v_announcement.status);
  end if;

  select count(*) into v_audience_count
  from public.announcement_audiences
  where announcement_id = p_announcement_id;

  if v_audience_count < 1 then
    raise exception 'code:validation_failed' using detail = 'announcement needs at least one audience before it can be published';
  end if;

  perform set_config('app.allow_announcement_publish', 'on', true);

  update public.announcements
  set status = 'published', published_at = now(), published_by = app.current_user_id()
  where id = p_announcement_id
  returning * into v_announcement;

  perform app.enqueue_job(
    v_announcement.institution_id,
    'notify.announcement',
    jsonb_build_object('announcement_id', v_announcement.id),
    'announcement:' || v_announcement.id::text
  );

  perform app.audit(
    v_announcement.institution_id,
    app.current_user_id(),
    'announcement.published',
    'announcement',
    v_announcement.id,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'published'),
    null
  );

  return v_announcement;
end;
$$;

revoke execute on function app.publish_announcement(uuid) from public, anon, authenticated;

create function public.publish_announcement(p_announcement_id uuid)
returns public.announcements
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.publish_announcement(p_announcement_id);
end;
$$;

revoke execute on function public.publish_announcement(uuid) from public, anon;
grant execute on function public.publish_announcement(uuid) to authenticated;
