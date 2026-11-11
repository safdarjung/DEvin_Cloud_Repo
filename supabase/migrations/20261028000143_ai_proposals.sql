-- 0143: orb task bridge — ai_proposals (docs/planning/orb-task-bridge/DESIGN.md §3, §7, §8-A).
--
-- One row per approval card. The chat tool `propose_task` and the action
-- `ai.proposal.start` insert it (status pending) as the signed-in user, after
-- stripping rule-6 (human-only) and generated keys, so `proposed` never holds
-- a value the AI may not supply. `ai.proposal.approve` claims it with a
-- conditional update (pending -> approving, guarded below), calls the target
-- registered action through the registry under the approver's own gates, and
-- records the outcome. Nothing executes without that click.
--
-- RLS: the creator reads and inserts their own rows in an institution they
-- belong to; owner/principal/admin (07 §2.2 `audit.read`) also read every row
-- of their institution. Column grants limit INSERT to the identity + proposal
-- columns (status defaults to pending). No UPDATE or DELETE for authenticated
-- (security review): every status change (claim, outcome, back to pending
-- after the target refused, discard, expiry) is written by the server through
-- the service role (caller `orb_tasks`, 07 §4) only after it has read the row
-- under the caller's RLS, so a creator cannot mark a card approved with a
-- forged result_ref, nor flip an in-flight claim back to pending.
-- app.guard_ai_proposal_update makes the identity immutable and enforces the
-- state machine for every writer, the service role included.
--
-- Retention (design §9.7): public.purge_ai_proposals() deletes rows older than
-- 30 days (service_role only, security invoker). Not scheduled yet (debt);
-- app.demo_reset already sweeps the demo tenant.

create table public.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  created_by uuid not null references public.profiles (id),
  action text not null check (action ~ '^[a-zA-Z][a-zA-Z0-9_.]{1,80}$'),
  proposed jsonb not null default '{}'::jsonb
    check (jsonb_typeof(proposed) = 'object' and octet_length(proposed::text) <= 8192),
  status text not null default 'pending'
    check (status in ('pending', 'approving', 'approved', 'discarded', 'expired', 'failed')),
  depends_on uuid,
  result_ref jsonb check (result_ref is null or (jsonb_typeof(result_ref) = 'object' and octet_length(result_ref::text) <= 2048)),
  changed_keys text[] check (changed_keys is null or cardinality(changed_keys) <= 100),
  error_code text check (error_code is null or length(error_code) <= 40),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_proposals_id_institution_key unique (id, institution_id),
  -- A card can only wait for a card of the same school.
  constraint ai_proposals_depends_on_fk
    foreign key (depends_on, institution_id) references public.ai_proposals (id, institution_id),
  constraint ai_proposals_not_self_dependent check (depends_on is distinct from id)
);

create index ai_proposals_creator_updated_idx on public.ai_proposals (created_by, updated_at desc);
create index ai_proposals_institution_created_idx on public.ai_proposals (institution_id, created_at desc);
create index ai_proposals_depends_on_idx on public.ai_proposals (depends_on) where depends_on is not null;

create trigger set_updated_at
before update on public.ai_proposals
for each row execute function app.set_updated_at();

-- State machine: pending -> approving (claim; not after expiry) | discarded |
-- expired; approving -> approved | failed | pending (target refused, retry
-- allowed with the same idempotency key). Terminal rows and identity columns
-- never change. Demo reset (app.allow_reset) bypasses, as for the other guards.
create function app.guard_ai_proposal_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_setting('app.allow_reset', true) = 'on' then
    return new;
  end if;

  if old.status in ('approved', 'discarded', 'expired', 'failed') then
    raise exception 'code:invalid_state' using detail = 'proposal is closed and cannot change';
  end if;

  if new.institution_id is distinct from old.institution_id
    or new.created_by is distinct from old.created_by
    or new.action is distinct from old.action
    or new.proposed is distinct from old.proposed
    or new.depends_on is distinct from old.depends_on
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'code:invalid_state' using detail = 'proposal identity columns are immutable';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status = 'pending' and new.status = 'approving' then
    if old.expires_at <= now() then
      raise exception 'code:invalid_state' using detail = 'proposal has expired';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status in ('discarded', 'expired') then
    return new;
  end if;

  if old.status = 'approving' and new.status in ('approved', 'failed', 'pending') then
    return new;
  end if;

  raise exception 'code:invalid_state' using detail = format('invalid proposal transition %s -> %s', old.status, new.status);
end;
$$;

create trigger guard_ai_proposal_update
before update on public.ai_proposals
for each row execute function app.guard_ai_proposal_update();

alter table public.ai_proposals enable row level security;

create policy ai_proposals_select on public.ai_proposals
  for select to authenticated
  using (
    (
      ai_proposals.created_by = (select app.current_user_id())
      and ai_proposals.institution_id = any((select app.my_institution_ids(
        array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher', 'student', 'guardian']
      )))
    )
    or ai_proposals.institution_id = any((select app.my_institution_ids(array['owner', 'principal', 'admin'])))
  );

create policy ai_proposals_insert on public.ai_proposals
  for insert to authenticated
  with check (
    ai_proposals.created_by = (select app.current_user_id())
    and ai_proposals.institution_id = any((select app.my_institution_ids(
      array['owner', 'principal', 'admin', 'admissions', 'accountant', 'exam_controller', 'teacher', 'student', 'guardian']
    )))
    and ai_proposals.status = 'pending'
    and ai_proposals.expires_at <= now() + interval '31 minutes'
  );

revoke all on public.ai_proposals from anon, authenticated;
grant select on public.ai_proposals to authenticated;
grant insert (id, institution_id, created_by, action, proposed, depends_on, expires_at) on public.ai_proposals to authenticated;
grant select, insert, update, delete on public.ai_proposals to service_role;

-- 30-day retention. A row a newer card still waits on is kept until that card ages out too.
create function public.purge_ai_proposals(p_older_than interval default interval '30 days')
returns integer
language sql
security invoker
set search_path = ''
as $$
  with gone as (
    delete from public.ai_proposals p
    where p.created_at < now() - p_older_than
      and not exists (
        select 1 from public.ai_proposals c where c.depends_on = p.id and c.created_at >= now() - p_older_than
      )
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.purge_ai_proposals(interval) from public, anon, authenticated;
grant execute on function public.purge_ai_proposals(interval) to service_role;
