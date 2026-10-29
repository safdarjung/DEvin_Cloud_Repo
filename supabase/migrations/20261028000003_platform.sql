-- T-005: audit_events, jobs, notifications, delivery_attempts, ai_usage_events + RLS.
-- Attaches the membership revision-audit trigger to `memberships` (created in
-- 0002) as a new, separate trigger — 0002 itself is not modified.

-- 0001's `revoke execute on all functions in schema app from public` was a
-- one-time grant revocation on the functions that existed at that moment;
-- it does not change the default for functions created afterwards (tried
-- `alter default privileges ... revoke execute on functions from public`
-- here first — confirmed empirically on this Postgres build that it is a
-- no-op for the FUNCTIONS object type: no pg_default_acl row is written and
-- PUBLIC still gets EXECUTE on the next function created). Every app.*
-- function added by 0002 got PUBLIC execute by default as a result. Revoke
-- it per-function instead, closing the 0002 gap now; this file's own new
-- functions are revoked individually in the grants section below.
revoke execute on function app.validate_term_dates(), app.handle_new_auth_user(), app.validate_membership_link()
from public;

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_institution_created_idx on public.audit_events (institution_id, created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

create trigger block_mutation
before update or delete on public.audit_events
for each row execute function app.block_mutation();

create function app.audit(
  p_institution_id uuid,
  p_actor uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.audit_events (institution_id, actor_user_id, action, entity_type, entity_id, before, after, metadata)
  values (p_institution_id, p_actor, p_action, p_entity_type, p_entity_id, p_before, p_after, p_metadata)
  returning id into v_id;

  return v_id;
end;
$$;

create function app.membership_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.audit(
    coalesce(new.institution_id, old.institution_id),
    app.current_user_id(),
    'membership.changed',
    'memberships',
    coalesce(new.id, old.id),
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    null
  );
  return coalesce(new, old);
end;
$$;

create trigger membership_audit
after insert or update on public.memberships
for each row execute function app.membership_changed();

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions (id),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_queued_idx on public.jobs (status, run_after) where status = 'queued';

create trigger set_updated_at
before update on public.jobs
for each row execute function app.set_updated_at();

create function app.enqueue_job(p_institution_id uuid, p_type text, p_payload jsonb, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Only end-user callers (an actual auth.uid() session) are membership-checked;
  -- service-role/internal callers (job handlers, other security-definer
  -- functions) have no JWT context and are trusted by definition.
  if p_institution_id is not null
    and app.current_user_id() is not null
    and not app.is_member(p_institution_id)
  then
    raise exception 'code:forbidden' using detail = 'caller is not a member of the target institution';
  end if;

  insert into public.jobs (institution_id, type, payload, idempotency_key)
  values (p_institution_id, p_type, p_payload, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.jobs where idempotency_key = p_idempotency_key;
  end if;

  return v_id;
end;
$$;

create function app.claim_job(p_worker_id text)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  update public.jobs
  set status = 'queued', locked_at = null, locked_by = null
  where status = 'running' and locked_at < now() - interval '10 minutes';

  update public.jobs
  set status = 'running', locked_at = now(), locked_by = p_worker_id, attempts = attempts + 1
  where id = (
    select id from public.jobs
    where status = 'queued' and run_after <= now()
    order by created_at
    for update skip locked
    limit 1
  )
  returning * into v_job;

  return v_job;
end;
$$;

create function app.complete_job(p_id uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
  v_max_attempts int;
begin
  if p_ok then
    update public.jobs set status = 'succeeded', last_error = null where id = p_id;
    return;
  end if;

  select attempts, max_attempts into v_attempts, v_max_attempts from public.jobs where id = p_id;

  if v_attempts >= v_max_attempts then
    update public.jobs set status = 'dead', last_error = p_error where id = p_id;
  else
    update public.jobs
    set status = 'queued', last_error = p_error, locked_at = null, locked_by = null,
        run_after = now() + (power(2, v_attempts) * interval '1 minute')
    where id = p_id;
  end if;
end;
$$;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  recipient_user_id uuid not null references public.profiles (id),
  type text not null,
  title text not null,
  body text not null,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notifications_recipient_created_idx on public.notifications (recipient_user_id, created_at desc);
create unique index notifications_data_key_idx on public.notifications (institution_id, (data ->> 'key')) where (data ->> 'key') is not null;

create trigger set_updated_at
before update on public.notifications
for each row execute function app.set_updated_at();

create function app.restrict_notification_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recipient_user_id is distinct from old.recipient_user_id
    or new.institution_id is distinct from old.institution_id
    or new.type is distinct from old.type
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.data is distinct from old.data
    or new.created_at is distinct from old.created_at
  then
    raise exception 'code:forbidden' using detail = 'only read_at may be updated on notifications';
  end if;

  return new;
end;
$$;

create trigger restrict_notification_update
before update on public.notifications
for each row execute function app.restrict_notification_update();

create table public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  notification_id uuid not null references public.notifications (id),
  channel text not null check (channel in ('in_app', 'sms', 'email')),
  status text not null check (status in ('queued', 'sent', 'failed', 'simulated')),
  to_address text,
  rendered_body text not null,
  provider text,
  provider_ref text,
  error text,
  attempted_at timestamptz not null default now()
);

create index delivery_attempts_notification_idx on public.delivery_attempts (notification_id);

create trigger block_mutation
before update or delete on public.delivery_attempts
for each row execute function app.block_mutation();

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  user_id uuid,
  feature text not null,
  provider text not null,
  model text not null,
  input_tokens int not null,
  output_tokens int not null,
  latency_ms int not null,
  cost_estimate_usd numeric(10, 6) not null,
  ok boolean not null,
  error_code text,
  redactions int not null default 0,
  created_at timestamptz not null default now()
);

create index ai_usage_events_institution_created_idx on public.ai_usage_events (institution_id, created_at);

create trigger block_mutation
before update or delete on public.ai_usage_events
for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.audit_events enable row level security;
alter table public.jobs enable row level security;
alter table public.notifications enable row level security;
alter table public.delivery_attempts enable row level security;
alter table public.ai_usage_events enable row level security;

-- audit_events: class A, SELECT only; writes go through app.audit (security definer).
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- jobs: SELECT/UPDATE(requeue) by owner/principal/admin; no INSERT policy (service-role/app.enqueue_job only).
create policy jobs_select on public.jobs
  for select to authenticated
  using (institution_id is not null and app.has_role(institution_id, array['owner', 'principal', 'admin']));

create policy jobs_update on public.jobs
  for update to authenticated
  using (institution_id is not null and app.has_role(institution_id, array['owner', 'principal', 'admin']))
  with check (institution_id is not null and app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- notifications: class O, own rows only; UPDATE restricted to read_at by trigger above.
create policy notifications_select on public.notifications
  for select to authenticated
  using (recipient_user_id = app.current_user_id());

create policy notifications_update on public.notifications
  for update to authenticated
  using (recipient_user_id = app.current_user_id())
  with check (recipient_user_id = app.current_user_id());

-- delivery_attempts: SELECT by owner/principal/admin/admissions; no write policies (job handlers use service role).
create policy delivery_attempts_select on public.delivery_attempts
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin', 'admissions']));

-- ai_usage_events: SELECT by owner/principal/admin; no write policies (AI gateway uses service role).
create policy ai_usage_events_select on public.ai_usage_events
  for select to authenticated
  using (app.has_role(institution_id, array['owner', 'principal', 'admin']));

-- ---------------------------------------------------------------------------
-- Grants (07 §4 allow-list)
-- ---------------------------------------------------------------------------

revoke execute on function
  app.audit(uuid, uuid, text, text, uuid, jsonb, jsonb, jsonb),
  app.membership_changed(),
  app.enqueue_job(uuid, text, jsonb, text),
  app.claim_job(text),
  app.complete_job(uuid, boolean, text),
  app.restrict_notification_update()
from public;

grant execute on function app.enqueue_job(uuid, text, jsonb, text) to authenticated;
