-- Features-18 #9 (SPEC §A): scholarships module — concession rules and
-- per-student concession awards with a two-person decision.
-- Recorded only: this migration never writes invoices, invoice_lines,
-- concessions or ledger_entries (honesty: <LimitedBadge /> "recorded, not
-- auto-applied to invoices").
--
-- Tables
--   concession_rules   named rule, percent XOR amount_paise, is_active
--   concession_awards  student + academic year (+ optional rule), percent
--                      XOR amount_paise, status pending -> approved |
--                      rejected (once). DB checks: decided_at set iff not
--                      pending; decided_by <> requested_by.
--
-- Functions
--   public.decide_concession_award(p_award_id uuid, p_decision text,
--     p_note text default null) -> jsonb
--     definer; concession.approve = owner, principal only; approver must
--     differ from requester; pending only; p_decision in approved|rejected;
--     note <= 500 chars (never audited).
--
-- RLS matrix (concession.read = concession.manage = app.finance_roles():
-- owner, principal, admin, accountant; concession.approve = owner,
-- principal):
--   table              select  insert                              update        delete
--   concession_rules   F       F                                   F (columns)   none
--   concession_awards  F       F (pending, requested_by = caller,  RPC only      none
--                                 undecided)
--   Other roles (teacher, guardian, student, ...): no access.

insert into app.module_catalog (key, default_enabled) values ('scholarships', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

-- ---------------------------------------------------------------------------
-- concession_rules
-- ---------------------------------------------------------------------------

create table public.concession_rules (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  name text not null check (char_length(name) between 1 and 80),
  criteria text check (char_length(criteria) between 1 and 500),
  percent numeric(5, 2) check (percent > 0 and percent <= 100),
  amount_paise bigint check (amount_paise > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint concession_rules_id_institution_key unique (id, institution_id),
  constraint concession_rules_name_key unique (institution_id, name),
  constraint concession_rules_one_value check (num_nonnulls(percent, amount_paise) = 1)
);

create trigger set_updated_at
before update on public.concession_rules
for each row execute function app.set_updated_at();

alter table public.concession_rules enable row level security;

create policy concession_rules_select on public.concession_rules
  for select to authenticated
  using (concession_rules.institution_id = any((select app.my_institution_ids(app.finance_roles()))));

create policy concession_rules_insert on public.concession_rules
  for insert to authenticated
  with check (concession_rules.institution_id = any((select app.my_institution_ids(app.finance_roles()))));

create policy concession_rules_update on public.concession_rules
  for update to authenticated
  using (concession_rules.institution_id = any((select app.my_institution_ids(app.finance_roles()))))
  with check (concession_rules.institution_id = any((select app.my_institution_ids(app.finance_roles()))));

revoke all on public.concession_rules from anon, authenticated;
grant select, insert on public.concession_rules to authenticated;
grant update (name, criteria, percent, amount_paise, is_active) on public.concession_rules to authenticated;
grant select, insert, update, delete on public.concession_rules to service_role;

-- ---------------------------------------------------------------------------
-- concession_awards — rule_id bound to the same institution by the
-- composite FK (null rule_id skips it, MATCH SIMPLE). No UPDATE grant or
-- policy for authenticated: decisions go through the definer below.
-- ---------------------------------------------------------------------------

create table public.concession_awards (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  academic_year_id uuid not null references public.academic_years (id),
  rule_id uuid,
  percent numeric(5, 2) check (percent > 0 and percent <= 100),
  amount_paise bigint check (amount_paise > 0),
  reason text not null check (char_length(reason) between 5 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null references public.profiles (id) default app.current_user_id(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint concession_awards_rule_fk foreign key (rule_id, institution_id) references public.concession_rules (id, institution_id),
  constraint concession_awards_one_value check (num_nonnulls(percent, amount_paise) = 1),
  constraint concession_awards_decided check ((status = 'pending') = (decided_at is null)),
  constraint concession_awards_two_person check (decided_by is null or decided_by <> requested_by)
);

create index concession_awards_institution_status_idx on public.concession_awards (institution_id, status, created_at desc);
create index concession_awards_student_idx on public.concession_awards (student_id, academic_year_id);

create trigger set_updated_at
before update on public.concession_awards
for each row execute function app.set_updated_at();

alter table public.concession_awards enable row level security;

create policy concession_awards_select on public.concession_awards
  for select to authenticated
  using (concession_awards.institution_id = any((select app.my_institution_ids(app.finance_roles()))));

create policy concession_awards_insert on public.concession_awards
  for insert to authenticated
  with check (
    concession_awards.institution_id = any((select app.my_institution_ids(app.finance_roles())))
    and concession_awards.status = 'pending'
    and concession_awards.requested_by = (select app.current_user_id())
    and concession_awards.decided_by is null
    and concession_awards.decided_at is null
    and concession_awards.decision_note is null
    and exists (
      select 1 from public.students s
      where s.id = concession_awards.student_id and s.institution_id = concession_awards.institution_id
    )
    and exists (
      select 1 from public.academic_years y
      where y.id = concession_awards.academic_year_id and y.institution_id = concession_awards.institution_id
    )
  );

revoke all on public.concession_awards from anon, authenticated;
grant select, insert on public.concession_awards to authenticated;
grant select, insert, update, delete on public.concession_awards to service_role;

-- ---------------------------------------------------------------------------
-- public.decide_concession_award — single public definer (0074
-- enqueue_fee_reminders shape). Caller check: non-member -> not_found,
-- member without concession.approve -> forbidden (0074 void_payment order).
-- ---------------------------------------------------------------------------

create function public.decide_concession_award(p_award_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_award public.concession_awards;
  v_note text := nullif(trim(p_note), '');
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_award from public.concession_awards where id = p_award_id for update;

  if v_award.id is null or not app.is_member(v_award.institution_id) then
    raise exception 'code:not_found' using detail = 'award not found';
  end if;

  if not app.has_role(v_award.institution_id, array['owner', 'principal']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold concession.approve for this institution';
  end if;

  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'code:validation_failed' using detail = 'decision must be approved or rejected';
  end if;

  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'code:validation_failed' using detail = 'note must be at most 500 characters';
  end if;

  if v_award.status <> 'pending' then
    raise exception 'code:invalid_state' using detail = 'award already decided';
  end if;

  if v_award.requested_by = app.current_user_id() then
    raise exception 'code:forbidden' using detail = 'approver must differ from requester';
  end if;

  update public.concession_awards
  set status = p_decision, decided_by = app.current_user_id(), decided_at = now(), decision_note = v_note
  where id = p_award_id;

  -- Never audit the note or reason (free text, lesson 10).
  perform app.audit(
    v_award.institution_id,
    app.current_user_id(),
    'concession.award.' || p_decision,
    'concession_award',
    p_award_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', p_decision),
    jsonb_build_object('percent', v_award.percent, 'amount_paise', v_award.amount_paise)
  );

  return jsonb_build_object('award_id', p_award_id, 'status', p_decision);
end;
$$;

revoke execute on function public.decide_concession_award(uuid, text, text) from public, anon;
grant execute on function public.decide_concession_award(uuid, text, text) to authenticated;
