-- Features-18 #22 (SPEC §A3): compliance module (`compliance`, default on).
-- Renewals and statutory tracker. The starter list of common items is a TS
-- template (titles only), not seeded here.
--
-- Tables
--   compliance_items   title, category, authority, reference_no, due_on,
--                      renew_every_months (nullable), owner_staff_id
--                      (nullable, same institution), notes. Status is never
--                      stored: computed from due_on vs the institution's
--                      local today (overdue < today; due_soon <= today + 30;
--                      else ok) in compliance_summary and the TS queries.
--                      due_on is set at insert and moved only by
--                      renew_compliance_item (not in the UPDATE grant).
--   compliance_events  append-only renewal history: renewed_on, new_due_on,
--                      document_id (nullable, active document of the same
--                      institution), note, recorded_by. Written only by
--                      renew_compliance_item; app.block_mutation stops
--                      update/delete (demo_reset bypass via app.allow_reset).
--
-- Enums
--   category: affiliation | safety | transport | staff | financial | other
--
-- Functions
--   public.renew_compliance_item(p_institution_id uuid, p_item_id uuid, p_renewed_on date,
--                                p_new_due_on date, p_document_id uuid, p_note text)
--     -> public.compliance_items (security definer; compliance.manage = M)
--     renewed_on null = institution-local today, may not be in the future.
--     new due = p_new_due_on, else greatest(due_on, renewed_on) +
--     renew_every_months (early renewal keeps the remaining period), else
--     validation_failed; must be after renewed_on. Inserts one event, moves
--     due_on, audits ids/dates only.
--   public.compliance_summary(p_institution_id uuid)
--     -> table (category text, status text, item_count int)
--     security invoker aggregate (RLS applies: non-readers get no rows).
--
-- RLS matrix (M = owner/principal/admin; R = M + accountant):
--   table              select  insert                update                    delete
--   compliance_items   R       M (columns, owner     M (columns, owner staff   M (fails while events
--                              staff bound)          bound; due_on excluded)   reference it: FK)
--   compliance_events  R       definer only          none                      none
--   Other roles: no access. revoke all from anon/authenticated, then re-grant
--   only the privileges above.
--
-- Seed notes: compliance_events.recorded_by has no default — seed passes it
-- explicitly. compliance_items has no user column.
--
-- Reuses (never redefines): app.set_updated_at, app.block_mutation,
-- app.current_user_id, app.has_role, app.my_institution_ids, app.audit,
-- app.module_catalog (0084).

insert into app.module_catalog (key, default_enabled) values ('compliance', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- compliance_items
-- ---------------------------------------------------------------------------

create table public.compliance_items (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  title text not null check (char_length(title) between 1 and 200),
  category text not null check (category in ('affiliation', 'safety', 'transport', 'staff', 'financial', 'other')),
  authority text check (char_length(authority) between 1 and 200),
  reference_no text check (char_length(reference_no) between 1 and 100),
  due_on date not null,
  renew_every_months smallint check (renew_every_months between 1 and 120),
  owner_staff_id uuid references public.staff (id),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compliance_items_id_institution_key unique (id, institution_id)
);

create index compliance_items_institution_due_idx on public.compliance_items (institution_id, due_on);
create index compliance_items_owner_staff_idx on public.compliance_items (owner_staff_id) where owner_staff_id is not null;

create trigger set_updated_at
before update on public.compliance_items
for each row execute function app.set_updated_at();

alter table public.compliance_items enable row level security;

create policy compliance_items_select on public.compliance_items
  for select to authenticated
  using (compliance_items.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'accountant']))));

create policy compliance_items_insert on public.compliance_items
  for insert to authenticated
  with check (
    compliance_items.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and (
      compliance_items.owner_staff_id is null
      or exists (
        select 1 from public.staff s
        where s.id = compliance_items.owner_staff_id and s.institution_id = compliance_items.institution_id
      )
    )
  );

create policy compliance_items_update on public.compliance_items
  for update to authenticated
  using (compliance_items.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))))
  with check (
    compliance_items.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
    and (
      compliance_items.owner_staff_id is null
      or exists (
        select 1 from public.staff s
        where s.id = compliance_items.owner_staff_id and s.institution_id = compliance_items.institution_id
      )
    )
  );

create policy compliance_items_delete on public.compliance_items
  for delete to authenticated
  using (compliance_items.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin']))));

revoke all on public.compliance_items from anon, authenticated;
grant select, delete on public.compliance_items to authenticated;
grant insert (institution_id, title, category, authority, reference_no, due_on, renew_every_months, owner_staff_id, notes)
  on public.compliance_items to authenticated;
grant update (title, category, authority, reference_no, renew_every_months, owner_staff_id, notes)
  on public.compliance_items to authenticated;

-- ---------------------------------------------------------------------------
-- compliance_events — append-only
-- ---------------------------------------------------------------------------

create table public.compliance_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  item_id uuid not null,
  renewed_on date not null,
  new_due_on date not null,
  document_id uuid references public.documents (id),
  note text check (char_length(note) between 1 and 500),
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compliance_events_item_fkey
    foreign key (item_id, institution_id) references public.compliance_items (id, institution_id),
  constraint compliance_events_due_after_renewal check (new_due_on > renewed_on)
);

create index compliance_events_item_created_idx on public.compliance_events (item_id, created_at desc);
create index compliance_events_institution_idx on public.compliance_events (institution_id);

create trigger set_updated_at
before update on public.compliance_events
for each row execute function app.set_updated_at();

create trigger block_mutation
before update or delete on public.compliance_events
for each row execute function app.block_mutation();

alter table public.compliance_events enable row level security;

create policy compliance_events_select on public.compliance_events
  for select to authenticated
  using (compliance_events.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin', 'accountant']))));

revoke all on public.compliance_events from anon, authenticated;
grant select on public.compliance_events to authenticated;

-- ---------------------------------------------------------------------------
-- public.renew_compliance_item — definer, compliance.manage (M) only.
-- ---------------------------------------------------------------------------

create function public.renew_compliance_item(
  p_institution_id uuid,
  p_item_id uuid,
  p_renewed_on date,
  p_new_due_on date,
  p_document_id uuid,
  p_note text
)
returns public.compliance_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.current_user_id();
  v_item public.compliance_items;
  v_today date;
  v_renewed_on date;
  v_new_due_on date;
  v_note text := nullif(btrim(p_note), '');
begin
  if v_uid is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, array['owner', 'principal', 'admin']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold compliance.manage for this institution';
  end if;

  select * into v_item
  from public.compliance_items ci
  where ci.id = p_item_id and ci.institution_id = p_institution_id
  for update;

  if v_item.id is null then
    raise exception 'code:not_found' using detail = 'compliance item not found';
  end if;

  select (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date into v_today
  from public.institutions i where i.id = p_institution_id;

  v_renewed_on := coalesce(p_renewed_on, v_today);
  if v_renewed_on > v_today then
    raise exception 'code:validation_failed' using detail = 'renewal date may not be in the future';
  end if;

  if p_new_due_on is not null then
    v_new_due_on := p_new_due_on;
  elsif v_item.renew_every_months is not null then
    v_new_due_on := (greatest(v_item.due_on, v_renewed_on) + make_interval(months => v_item.renew_every_months))::date;
  else
    raise exception 'code:validation_failed' using detail = 'new due date is required for an item without a renewal period';
  end if;

  if v_new_due_on <= v_renewed_on then
    raise exception 'code:validation_failed' using detail = 'new due date must be after the renewal date';
  end if;

  if p_document_id is not null and not exists (
    select 1 from public.documents d
    where d.id = p_document_id and d.institution_id = p_institution_id and d.status = 'active'
  ) then
    raise exception 'code:validation_failed' using detail = 'document must be an active document of this institution';
  end if;

  if char_length(v_note) > 500 then
    raise exception 'code:validation_failed' using detail = 'note must be at most 500 characters';
  end if;

  insert into public.compliance_events (institution_id, item_id, renewed_on, new_due_on, document_id, note, recorded_by)
  values (p_institution_id, p_item_id, v_renewed_on, v_new_due_on, p_document_id, v_note, v_uid);

  update public.compliance_items
  set due_on = v_new_due_on
  where id = p_item_id
  returning * into v_item;

  perform app.audit(
    p_institution_id, v_uid, 'compliance.item.renewed', 'compliance_items', p_item_id,
    null,
    jsonb_build_object('item_id', p_item_id, 'renewed_on', v_renewed_on, 'new_due_on', v_new_due_on, 'document_id', p_document_id),
    null
  );

  return v_item;
end;
$$;

revoke execute on function public.renew_compliance_item(uuid, uuid, date, date, uuid, text) from public, anon;
grant execute on function public.renew_compliance_item(uuid, uuid, date, date, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.compliance_summary — invoker aggregate (not a view: app.demo_reset
-- deletes from every public relation with an institution_id column, 0120).
-- Counts by category x computed status; zero-count pairs are omitted.
-- ---------------------------------------------------------------------------

create function public.compliance_summary(p_institution_id uuid)
returns table (category text, status text, item_count int)
language sql
stable
security invoker
set search_path = ''
as $$
  with today as (
    select (now() at time zone coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'))::date as d
    from public.institutions i
    where i.id = p_institution_id
  )
  select
    ci.category,
    case
      when ci.due_on < t.d then 'overdue'
      when ci.due_on <= t.d + 30 then 'due_soon'
      else 'ok'
    end,
    count(*)::int
  from public.compliance_items ci
  cross join today t
  where ci.institution_id = p_institution_id
  group by 1, 2
  order by 1, 2;
$$;

revoke execute on function public.compliance_summary(uuid) from public, anon;
grant execute on function public.compliance_summary(uuid) to authenticated;
