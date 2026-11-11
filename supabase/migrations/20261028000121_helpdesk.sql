-- Features-18 #12: helpdesk (module key `helpdesk`, default enabled).
--
-- Tables
--   helpdesk_tickets   raised_by (profile), category, priority, status,
--                      assignee_staff_id, due_at (computed in SQL from
--                      priority at raise time: urgent 4h, high 24h,
--                      normal 72h, low 7d), resolved_at. No direct
--                      INSERT/UPDATE/DELETE for API roles — definers only.
--   helpdesk_messages  append-only thread on a ticket (composite
--                      same-institution FK). INSERT through RLS with a
--                      column-level grant (institution_id, ticket_id, body):
--                      author_id / created_at always come from defaults.
--                      app.block_mutation stops update/delete for everyone
--                      except app.demo_reset (app.allow_reset).
--
-- Enums
--   category: academics | fees | transport | technical | facilities | other
--   priority: low | normal | high | urgent
--   status:   open | in_progress | resolved | closed
--
-- Functions (public, PostgREST-callable, definers)
--   raise_helpdesk_ticket(p_institution_id uuid, p_category text, p_priority text, p_subject text, p_body text) -> jsonb
--     helpdesk.raise roles (guardian, student, teacher); inserts the ticket
--     plus its first message; at most 10 open/in_progress tickets per
--     raiser (code:rate_limited). Returns {ticket_id, due_at}.
--   update_helpdesk_ticket(p_institution_id uuid, p_ticket_id uuid, p_status text, p_assignee_staff_id uuid) -> jsonb
--     helpdesk.manage roles (owner, principal, admin). Sets BOTH status and
--     assignee (null = unassigned); callers pass the current value to keep
--     one. Assignee must be an active owner/principal/admin staff member of
--     the same institution. resolved_at stamped on entering
--     resolved/closed, cleared on reopen. Returns {ticket_id, status,
--     assignee_staff_id}.
--
-- RLS matrix (M = owner, principal, admin; R = guardian, student, teacher)
--   helpdesk_tickets   select: M (institution) | R where raised_by = caller
--                      (active R membership in that institution);
--                      insert/update/delete: none.
--   helpdesk_messages  select: inherits ticket visibility (RLS-filtered
--                      subquery); insert: M on any ticket of the
--                      institution | raiser on own ticket while not closed;
--                      author_id must be the caller; update/delete: none.
--   Other staff roles (accountant, admissions, exam_controller): no access.
--   Both tables: revoke all from anon/authenticated, then re-grant only the
--   privileges above (no TRUNCATE/REFERENCES/TRIGGER).
--
-- Helpers reused, never redefined: app.set_updated_at, app.block_mutation,
-- app.has_role, app.current_user_id (0001), app.audit (0003),
-- app.my_institution_ids (0020), app.module_catalog (0084).

insert into app.module_catalog (key, default_enabled) values ('helpdesk', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- helpdesk_tickets
-- ---------------------------------------------------------------------------

create table public.helpdesk_tickets (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  raised_by uuid not null references public.profiles (id),
  category text not null check (category in ('academics', 'fees', 'transport', 'technical', 'facilities', 'other')),
  priority text not null check (priority in ('low', 'normal', 'high', 'urgent')),
  subject text not null check (char_length(subject) between 1 and 200),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  assignee_staff_id uuid references public.staff (id),
  due_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint helpdesk_tickets_id_institution_key unique (id, institution_id),
  constraint helpdesk_tickets_resolved_state check ((resolved_at is not null) = (status in ('resolved', 'closed')))
);

create index helpdesk_tickets_institution_status_due_idx on public.helpdesk_tickets (institution_id, status, due_at);
create index helpdesk_tickets_raised_by_idx on public.helpdesk_tickets (raised_by, created_at desc);
create index helpdesk_tickets_assignee_idx on public.helpdesk_tickets (assignee_staff_id) where assignee_staff_id is not null;

create trigger set_updated_at
before update on public.helpdesk_tickets
for each row execute function app.set_updated_at();

alter table public.helpdesk_tickets enable row level security;

revoke all on public.helpdesk_tickets from anon, authenticated;
grant select on public.helpdesk_tickets to authenticated;

create policy helpdesk_tickets_select on public.helpdesk_tickets
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    or (
      raised_by = (select app.current_user_id())
      and institution_id = any((select app.my_institution_ids(array['guardian', 'student', 'teacher'])))
    )
  );

-- ---------------------------------------------------------------------------
-- helpdesk_messages — append-only
-- ---------------------------------------------------------------------------

create table public.helpdesk_messages (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  ticket_id uuid not null,
  author_id uuid not null default app.current_user_id() references public.profiles (id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint helpdesk_messages_ticket_fkey
    foreign key (ticket_id, institution_id) references public.helpdesk_tickets (id, institution_id)
);

create index helpdesk_messages_ticket_created_idx on public.helpdesk_messages (ticket_id, created_at);
create index helpdesk_messages_institution_idx on public.helpdesk_messages (institution_id);

create trigger set_updated_at
before update on public.helpdesk_messages
for each row execute function app.set_updated_at();

create trigger block_mutation
before update or delete on public.helpdesk_messages
for each row execute function app.block_mutation();

alter table public.helpdesk_messages enable row level security;

-- Clients may only name the ticket and the body; id, author_id and
-- created_at/updated_at always come from column defaults.
revoke all on public.helpdesk_messages from anon, authenticated;
grant select on public.helpdesk_messages to authenticated;
grant insert (institution_id, ticket_id, body) on public.helpdesk_messages to authenticated;

-- Messages inherit ticket visibility: the subquery is itself RLS-filtered.
create policy helpdesk_messages_select on public.helpdesk_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.helpdesk_tickets t
      where t.id = helpdesk_messages.ticket_id
        and t.institution_id = helpdesk_messages.institution_id
    )
  );

create policy helpdesk_messages_insert on public.helpdesk_messages
  for insert to authenticated
  with check (
    helpdesk_messages.author_id = (select app.current_user_id())
    and (
      (
        helpdesk_messages.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
        and exists (
          select 1 from public.helpdesk_tickets t
          where t.id = helpdesk_messages.ticket_id
            and t.institution_id = helpdesk_messages.institution_id
        )
      )
      or (
        helpdesk_messages.institution_id = any((select app.my_institution_ids(array['guardian', 'student', 'teacher'])))
        and exists (
          select 1 from public.helpdesk_tickets t
          where t.id = helpdesk_messages.ticket_id
            and t.institution_id = helpdesk_messages.institution_id
            and t.raised_by = (select app.current_user_id())
            and t.status <> 'closed'
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- public.raise_helpdesk_ticket — definer.
-- ---------------------------------------------------------------------------

create function public.raise_helpdesk_ticket(
  p_institution_id uuid,
  p_category text,
  p_priority text,
  p_subject text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.current_user_id();
  v_open_count int;
  v_due_at timestamptz;
  v_ticket_id uuid;
begin
  if not app.has_role(p_institution_id, array['guardian', 'student', 'teacher']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold helpdesk.raise for this institution';
  end if;

  if p_priority is null or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'code:validation_failed' using detail = 'priority must be low, normal, high or urgent';
  end if;

  -- Category/length violations surface as 23514 (validation_failed); null
  -- would surface as 23502 (internal), so refuse it here.
  if p_category is null or p_subject is null or p_body is null then
    raise exception 'code:validation_failed' using detail = 'category, subject and body are required';
  end if;

  -- Serialise one raiser's concurrent raises so the open-ticket cap holds.
  perform pg_advisory_xact_lock(hashtextextended('helpdesk_raiser:' || v_user::text, 0));

  select count(*) into v_open_count
  from public.helpdesk_tickets t
  where t.institution_id = p_institution_id
    and t.raised_by = v_user
    and t.status in ('open', 'in_progress');

  if v_open_count >= 10 then
    raise exception 'code:rate_limited' using detail = 'too many open helpdesk tickets';
  end if;

  v_due_at := now() + case p_priority
    when 'urgent' then interval '4 hours'
    when 'high' then interval '24 hours'
    when 'normal' then interval '72 hours'
    else interval '7 days'
  end;

  insert into public.helpdesk_tickets (institution_id, raised_by, category, priority, subject, due_at)
  values (p_institution_id, v_user, p_category, p_priority, btrim(p_subject), v_due_at)
  returning id into v_ticket_id;

  insert into public.helpdesk_messages (institution_id, ticket_id, author_id, body)
  values (p_institution_id, v_ticket_id, v_user, btrim(p_body));

  perform app.audit(
    p_institution_id,
    v_user,
    'helpdesk.ticket.raised',
    'helpdesk_tickets',
    v_ticket_id,
    null,
    jsonb_build_object('ticket_id', v_ticket_id, 'category', p_category, 'priority', p_priority, 'due_at', v_due_at),
    null
  );

  return jsonb_build_object('ticket_id', v_ticket_id, 'due_at', v_due_at);
end;
$$;

revoke execute on function public.raise_helpdesk_ticket(uuid, text, text, text, text) from public, anon;
grant execute on function public.raise_helpdesk_ticket(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.update_helpdesk_ticket — definer, managers only.
-- ---------------------------------------------------------------------------

create function public.update_helpdesk_ticket(
  p_institution_id uuid,
  p_ticket_id uuid,
  p_status text,
  p_assignee_staff_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.helpdesk_tickets;
  v_resolved_at timestamptz;
begin
  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold helpdesk.manage for this institution';
  end if;

  if p_status is null or p_status not in ('open', 'in_progress', 'resolved', 'closed') then
    raise exception 'code:validation_failed' using detail = 'status must be open, in_progress, resolved or closed';
  end if;

  select * into v_ticket
  from public.helpdesk_tickets t
  where t.id = p_ticket_id and t.institution_id = p_institution_id
  for update;

  if v_ticket.id is null then
    raise exception 'code:not_found' using detail = 'ticket not found';
  end if;

  if p_assignee_staff_id is not null and not exists (
    select 1
    from public.memberships m
    join public.staff s
      on s.id = m.staff_id
     and s.institution_id = m.institution_id
    where m.institution_id = p_institution_id
      and m.staff_id = p_assignee_staff_id
      and m.status = 'active'
      and m.role = any(array['owner', 'principal', 'admin'])
  ) then
    raise exception 'code:validation_failed' using detail = 'assignee must be an active helpdesk manager of this institution';
  end if;

  v_resolved_at := case
    when p_status in ('resolved', 'closed') then coalesce(v_ticket.resolved_at, now())
    else null
  end;

  update public.helpdesk_tickets
  set status = p_status,
      assignee_staff_id = p_assignee_staff_id,
      resolved_at = v_resolved_at
  where id = p_ticket_id;

  perform app.audit(
    p_institution_id,
    app.current_user_id(),
    'helpdesk.ticket.updated',
    'helpdesk_tickets',
    p_ticket_id,
    jsonb_build_object('status', v_ticket.status, 'assignee_staff_id', v_ticket.assignee_staff_id),
    jsonb_build_object('status', p_status, 'assignee_staff_id', p_assignee_staff_id),
    null
  );

  return jsonb_build_object('ticket_id', p_ticket_id, 'status', p_status, 'assignee_staff_id', p_assignee_staff_id);
end;
$$;

revoke execute on function public.update_helpdesk_ticket(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.update_helpdesk_ticket(uuid, uuid, text, uuid) to authenticated;
