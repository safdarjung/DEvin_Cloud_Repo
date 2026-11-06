-- Parent-teacher messaging (Education OS redesign, Lane E).
-- message_threads (one per student x guardian x teacher x subject) and
-- messages (append-only body; only read_at changes, by the non-sender).
-- Reads: RLS. Writes: ONLY the three definer RPCs below
-- (start_message_thread / send_message / mark_thread_read); every table
-- write is also blocked by a guard trigger and revoked from API roles.
-- Helpers owned by other migrations (app.my_staff_ids 0070,
-- app.my_guardian_student_ids 0090, app.my_taught_student_ids 0025/0035,
-- app.my_institution_ids 0020) are reused, never redefined.

-- ---------------------------------------------------------------------------
-- app.my_guardian_ids — guardian rows the caller is (0090 only owns the
-- student-id side). Same shape as app.my_staff_ids.
-- ---------------------------------------------------------------------------

create function app.my_guardian_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.guardian_id
  from public.memberships m
  where m.user_id = app.current_user_id()
    and m.status = 'active'
    and m.guardian_id is not null;
$$;

revoke execute on function app.my_guardian_ids() from public;
grant execute on function app.my_guardian_ids() to authenticated;
comment on function app.my_guardian_ids() is
  'RLS helper (messaging): guardian ids of the caller''s active guardian memberships. Called as (select app.my_guardian_ids()) inside policies.';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  guardian_id uuid not null references public.guardians (id),
  teacher_staff_id uuid not null references public.staff (id),
  subject text not null check (length(subject) between 1 and 200),
  last_message_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, student_id, guardian_id, teacher_staff_id, subject)
);

create index message_threads_institution_last_idx on public.message_threads (institution_id, last_message_at desc);
create index message_threads_guardian_idx on public.message_threads (guardian_id);
create index message_threads_teacher_idx on public.message_threads (teacher_staff_id);
create index message_threads_student_idx on public.message_threads (student_id);

create trigger set_updated_at
before update on public.message_threads
for each row execute function app.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  thread_id uuid not null references public.message_threads (id),
  sender_profile_id uuid not null references public.profiles (id),
  body text not null check (length(body) between 1 and 4000),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index messages_thread_created_idx on public.messages (thread_id, created_at);
create index messages_institution_idx on public.messages (institution_id);

create trigger set_updated_at
before update on public.messages
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Guards (lesson-5 bypass for service_role / postgres: seed, demo reset).
-- Writes need the transaction-local flag only the definer RPCs set.
-- ---------------------------------------------------------------------------

create function app.guard_message_threads()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return coalesce(new, old);
  end if;

  if current_setting('app.allow_message_write', true) is distinct from 'on' then
    raise exception 'code:forbidden' using detail = 'message threads change only via the messaging RPCs';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'code:forbidden' using detail = 'message threads cannot be deleted';
  end if;

  if tg_op = 'UPDATE' and (
    new.institution_id is distinct from old.institution_id
    or new.student_id is distinct from old.student_id
    or new.guardian_id is distinct from old.guardian_id
    or new.teacher_staff_id is distinct from old.teacher_staff_id
    or new.subject is distinct from old.subject
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'code:invalid_state' using detail = 'thread identity columns are immutable';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_message_threads() from public;

create trigger guard_message_threads
before insert or update or delete on public.message_threads
for each row execute function app.guard_message_threads();

create function app.guard_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or session_user = 'postgres'
  then
    return coalesce(new, old);
  end if;

  if current_setting('app.allow_message_write', true) is distinct from 'on' then
    raise exception 'code:forbidden' using detail = 'messages change only via the messaging RPCs';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'code:forbidden' using detail = 'messages cannot be deleted';
  end if;

  if tg_op = 'UPDATE' then
    if new.institution_id is distinct from old.institution_id
      or new.thread_id is distinct from old.thread_id
      or new.sender_profile_id is distinct from old.sender_profile_id
      or new.body is distinct from old.body
      or new.created_at is distinct from old.created_at
    then
      raise exception 'code:invalid_state' using detail = 'message body and identity are immutable; only read_at may be set';
    end if;
    if old.read_at is not null and new.read_at is distinct from old.read_at then
      raise exception 'code:invalid_state' using detail = 'message already read';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_messages() from public;

create trigger guard_messages
before insert or update or delete on public.messages
for each row execute function app.guard_messages();

-- ---------------------------------------------------------------------------
-- RLS — read only. No insert/update/delete policy exists, and the API roles
-- lose the table privileges outright.
-- ---------------------------------------------------------------------------

alter table public.message_threads enable row level security;
alter table public.messages enable row level security;

revoke insert, update, delete on public.message_threads from anon, authenticated;
revoke insert, update, delete on public.messages from anon, authenticated;

create policy message_threads_select on public.message_threads
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      guardian_id = any((select app.my_guardian_ids()))
      and student_id = any((select app.my_guardian_student_ids()))
    )
    or (
      teacher_staff_id = any((select app.my_staff_ids()))
      and student_id = any((select app.my_taught_student_ids()))
    )
  );

-- Messages inherit thread visibility: the subquery is itself RLS-filtered.
create policy messages_select on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.message_threads t
      where t.id = messages.thread_id and t.institution_id = messages.institution_id
    )
  );

-- ---------------------------------------------------------------------------
-- Internal helpers (revoked from everyone; only the definer RPCs call them).
-- ---------------------------------------------------------------------------

-- Does this staff member teach (class teacher or subject teacher of an active
-- section of) this student?
create function app.staff_teaches_student(p_institution_id uuid, p_staff_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enrolments e
    join public.class_sections cs
      on cs.id = e.class_section_id and cs.institution_id = e.institution_id
    where e.institution_id = p_institution_id
      and e.student_id = p_student_id
      and e.status = 'active'
      and (
        cs.class_teacher_id = p_staff_id
        or exists (
          select 1 from public.subject_assignments sa
          where sa.class_section_id = cs.id and sa.teacher_id = p_staff_id
        )
      )
  );
$$;

revoke all on function app.staff_teaches_student(uuid, uuid, uuid) from public, anon, authenticated;

-- 'guardian' | 'teacher' | null: the caller's side of an existing thread,
-- re-checking the relationship still holds (guardian link, teaching).
create function app.message_side(p_thread public.message_threads)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.memberships m
    join public.guardian_students gs
      on gs.guardian_id = m.guardian_id and gs.institution_id = m.institution_id
    where m.user_id = app.current_user_id()
      and m.status = 'active'
      and m.institution_id = p_thread.institution_id
      and m.guardian_id = p_thread.guardian_id
      and gs.student_id = p_thread.student_id
  ) then
    return 'guardian';
  end if;

  if exists (
    select 1
    from public.memberships m
    where m.user_id = app.current_user_id()
      and m.status = 'active'
      and m.institution_id = p_thread.institution_id
      and m.staff_id = p_thread.teacher_staff_id
  ) and app.staff_teaches_student(p_thread.institution_id, p_thread.teacher_staff_id, p_thread.student_id) then
    return 'teacher';
  end if;

  return null;
end;
$$;

revoke all on function app.message_side(public.message_threads) from public, anon, authenticated;

-- Inserts the message, bumps the thread, notifies the other side. Caller
-- (definer RPC) has already authorised.
create function app.post_message(p_thread public.message_threads, p_sender uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
  v_sender_name text;
begin
  perform set_config('app.allow_message_write', 'on', true);

  insert into public.messages (institution_id, thread_id, sender_profile_id, body)
  values (p_thread.institution_id, p_thread.id, p_sender, p_body)
  returning * into v_message;

  update public.message_threads set last_message_at = v_message.created_at where id = p_thread.id;

  select coalesce(nullif(full_name, ''), 'Someone') into v_sender_name from public.profiles where id = p_sender;

  insert into public.notifications (institution_id, recipient_user_id, type, title, body, data)
  select p_thread.institution_id,
         m.user_id,
         'message.received',
         'New message from ' || coalesce(v_sender_name, 'Someone'),
         left(p_body, 140),
         jsonb_build_object('thread_id', p_thread.id, 'student_id', p_thread.student_id)
  from public.memberships m
  where m.institution_id = p_thread.institution_id
    and m.status = 'active'
    and m.user_id <> p_sender
    and (m.guardian_id = p_thread.guardian_id or m.staff_id = p_thread.teacher_staff_id);

  return v_message;
end;
$$;

revoke all on function app.post_message(public.message_threads, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.start_message_thread
-- Guardian caller: p_counterpart_id = teacher staff id (must teach the child).
-- Teacher caller:  p_counterpart_id = guardian id (must be linked to the child,
-- and the teacher must teach the child). Re-starting the same
-- (student, guardian, teacher, subject) appends to the existing thread.
-- ---------------------------------------------------------------------------

create function public.start_message_thread(
  p_institution_id uuid,
  p_student_id uuid,
  p_counterpart_id uuid,
  p_subject text,
  p_body text
)
returns public.message_threads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_guardian_id uuid;
  v_staff_id uuid;
  v_thread public.message_threads;
  v_created boolean := false;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_subject is null or length(btrim(p_subject)) not between 1 and 200
    or p_body is null or length(btrim(p_body)) not between 1 and 4000
  then
    raise exception 'code:validation_failed' using detail = 'subject 1-200 and body 1-4000 characters required';
  end if;

  if not app.is_member(p_institution_id) then
    raise exception 'code:not_found' using detail = 'institution not found';
  end if;

  if not app.module_enabled(p_institution_id, 'messaging') then
    raise exception 'code:forbidden' using detail = 'messaging is not enabled for this school';
  end if;

  if app.has_role(p_institution_id, array['guardian'])
    and p_student_id in (select app.guardian_student_ids(p_institution_id))
  then
    v_staff_id := p_counterpart_id;
    select m.guardian_id into v_guardian_id
    from public.memberships m
    join public.guardian_students gs
      on gs.guardian_id = m.guardian_id and gs.institution_id = m.institution_id
    where m.user_id = v_caller and m.institution_id = p_institution_id
      and m.status = 'active' and gs.student_id = p_student_id
    limit 1;
  elsif app.has_role(p_institution_id, array['teacher']) then
    v_guardian_id := p_counterpart_id;
    v_staff_id := app.staff_id(p_institution_id);
    if v_staff_id is null or not exists (
      select 1 from public.guardian_students gs
      where gs.institution_id = p_institution_id
        and gs.guardian_id = p_counterpart_id
        and gs.student_id = p_student_id
    ) then
      raise exception 'code:forbidden' using detail = 'guardian is not linked to this student';
    end if;
  else
    raise exception 'code:forbidden' using detail = 'only guardians and teachers may start a message thread';
  end if;

  if v_guardian_id is null or v_staff_id is null
    or not exists (select 1 from public.staff s where s.id = v_staff_id and s.institution_id = p_institution_id)
    or not app.staff_teaches_student(p_institution_id, v_staff_id, p_student_id)
  then
    raise exception 'code:forbidden' using detail = 'teacher does not teach this student';
  end if;

  perform set_config('app.allow_message_write', 'on', true);

  insert into public.message_threads (institution_id, student_id, guardian_id, teacher_staff_id, subject, created_by)
  values (p_institution_id, p_student_id, v_guardian_id, v_staff_id, btrim(p_subject), v_caller)
  on conflict (institution_id, student_id, guardian_id, teacher_staff_id, subject) do nothing
  returning * into v_thread;

  if v_thread.id is not null then
    v_created := true;
  else
    select * into v_thread from public.message_threads
    where institution_id = p_institution_id and student_id = p_student_id
      and guardian_id = v_guardian_id and teacher_staff_id = v_staff_id and subject = btrim(p_subject);
  end if;

  perform app.post_message(v_thread, v_caller, btrim(p_body));

  if v_created then
    perform app.audit(
      p_institution_id,
      v_caller,
      'message_thread.started',
      'message_thread',
      v_thread.id,
      null,
      jsonb_build_object('student_id', p_student_id, 'guardian_id', v_guardian_id, 'teacher_staff_id', v_staff_id),
      null
    );
  end if;

  select * into v_thread from public.message_threads where id = v_thread.id;
  return v_thread;
end;
$$;

revoke execute on function public.start_message_thread(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.start_message_thread(uuid, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.send_message — participants only; relationship re-checked.
-- ---------------------------------------------------------------------------

create function public.send_message(p_thread_id uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_thread public.message_threads;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if p_body is null or length(btrim(p_body)) not between 1 and 4000 then
    raise exception 'code:validation_failed' using detail = 'body 1-4000 characters required';
  end if;

  select * into v_thread from public.message_threads where id = p_thread_id for update;

  if v_thread.id is null or not app.is_member(v_thread.institution_id) then
    raise exception 'code:not_found' using detail = 'thread not found';
  end if;

  if not app.module_enabled(v_thread.institution_id, 'messaging') then
    raise exception 'code:forbidden' using detail = 'messaging is not enabled for this school';
  end if;

  if app.message_side(v_thread) is null then
    raise exception 'code:forbidden' using detail = 'only the thread participants may send messages';
  end if;

  return app.post_message(v_thread, v_caller, btrim(p_body));
end;
$$;

revoke execute on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.mark_thread_read — stamps read_at on the OTHER side's unread
-- messages; returns how many were marked.
-- ---------------------------------------------------------------------------

create function public.mark_thread_read(p_thread_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := app.current_user_id();
  v_thread public.message_threads;
  v_count int;
begin
  if v_caller is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_thread from public.message_threads where id = p_thread_id;

  if v_thread.id is null or not app.is_member(v_thread.institution_id) then
    raise exception 'code:not_found' using detail = 'thread not found';
  end if;

  if app.message_side(v_thread) is null then
    raise exception 'code:forbidden' using detail = 'only the thread participants may mark it read';
  end if;

  perform set_config('app.allow_message_write', 'on', true);

  update public.messages
  set read_at = now()
  where thread_id = p_thread_id
    and sender_profile_id <> v_caller
    and read_at is null;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke execute on function public.mark_thread_read(uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Read helpers. Guardians cannot read staff rows and students/teachers
-- cannot read each other's names under RLS, so both are definer reads that
-- re-check the caller's relationship.
-- ---------------------------------------------------------------------------

-- Teachers a guardian may message about one of their own children (class
-- teacher + subject teachers of the child's active section).
create function public.messageable_teachers(p_institution_id uuid, p_student_id uuid)
returns table (staff_id uuid, full_name text, is_class_teacher boolean, subject_names text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, array['guardian'])
    or p_student_id not in (select app.guardian_student_ids(p_institution_id))
  then
    return;
  end if;

  return query
    select s.id,
           s.full_name,
           bool_or(cs.class_teacher_id = s.id),
           coalesce(array_agg(distinct sub.name) filter (where sub.name is not null), array[]::text[])
    from public.enrolments e
    join public.class_sections cs
      on cs.id = e.class_section_id and cs.institution_id = e.institution_id
    left join public.subject_assignments sa on sa.class_section_id = cs.id
    left join public.subjects sub on sub.id = sa.subject_id
    join public.staff s
      on s.institution_id = e.institution_id
     and (s.id = cs.class_teacher_id or s.id = sa.teacher_id)
    where e.institution_id = p_institution_id
      and e.student_id = p_student_id
      and e.status = 'active'
    group by s.id, s.full_name
    order by s.full_name;
end;
$$;

revoke execute on function public.messageable_teachers(uuid, uuid) from public, anon;
grant execute on function public.messageable_teachers(uuid, uuid) to authenticated;

-- Display names for threads the caller participates in (or leads).
create function public.message_thread_names(p_thread_ids uuid[])
returns table (thread_id uuid, guardian_name text, teacher_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  return query
    select t.id, g.full_name, s.full_name
    from public.message_threads t
    join public.guardians g on g.id = t.guardian_id
    join public.staff s on s.id = t.teacher_staff_id
    where t.id = any(p_thread_ids)
      and (
        app.message_side(t) is not null
        or app.has_role(t.institution_id, array['owner', 'principal', 'admin'])
      );
end;
$$;

revoke execute on function public.message_thread_names(uuid[]) from public, anon;
grant execute on function public.message_thread_names(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Module catalog (0084's table; insert only).
-- ---------------------------------------------------------------------------

insert into app.module_catalog (key, default_enabled) values ('messaging', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;
