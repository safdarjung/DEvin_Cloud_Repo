-- X04-T2: fee_plans module, part 1 of 2 (X04-tasks.md header + Task 2) —
-- late_fee_rules, invoice_instalments, late_fee_charges tables + RLS,
-- app.invoice_principal, public.set_invoice_instalments,
-- public.invoice_instalment_status, app.module_catalog insert. Part 2
-- (X04-T4) appends apply_late_fees/enqueue_due_late_fees + late-fee voucher
-- lines to this same file.
--
-- app.module_enabled (0084, MOD-T12) is CREATE OR REPLACE'd below to add
-- `fee_plans` to its hardcoded `requires` case (-> finance_plus). 0084's own
-- header anticipates this ("a future `requires` key needs app.module_enabled
-- edited in a new migration, same as any other logic change to it") — the
-- function's other 31 module keys and all existing logic are reproduced
-- byte-for-byte, only the new case arm is added.

-- ---------------------------------------------------------------------------
-- late_fee_rules — one row per fee structure (ruling "Late-fee rule").
-- No DELETE policy: deactivate via is_active instead.
-- ---------------------------------------------------------------------------

create table public.late_fee_rules (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  fee_structure_id uuid not null unique references public.fee_structures (id),
  kind text not null check (kind in ('flat', 'per_day')),
  amount numeric(12, 2) not null check (amount > 0),
  grace_days int not null default 0 check (grace_days between 0 and 90),
  cap numeric(12, 2),
  is_active boolean not null default true,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'flat' and cap is null) or (kind = 'per_day' and cap is not null and cap >= amount))
);

create index late_fee_rules_institution_id_idx on public.late_fee_rules (institution_id);

create trigger set_updated_at
before update on public.late_fee_rules
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- invoice_instalments — written only by public.set_invoice_instalments
-- below (ruling "Instalment plans"). No insert/update/delete policy
-- (lesson 3): the definer function runs as its owner, which bypasses RLS.
-- ---------------------------------------------------------------------------

create table public.invoice_instalments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  invoice_id uuid not null references public.invoices (id),
  seq int not null check (seq between 1 and 12),
  due_on date not null,
  amount numeric(12, 2) not null check (amount >= 1.00),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, seq)
);

create index invoice_instalments_institution_id_idx on public.invoice_instalments (institution_id);
create index invoice_instalments_invoice_id_idx on public.invoice_instalments (invoice_id);

create trigger set_updated_at
before update on public.invoice_instalments
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- late_fee_charges — immutable record + idempotency key (ruling
-- "late_fee_charges"). Inserted only by app.apply_late_fees (X04-T4, via
-- app.add_invoice_charge). block_mutation carries the usual demo_reset
-- bypass (0001's app.allow_reset config flag).
-- ---------------------------------------------------------------------------

create table public.late_fee_charges (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  invoice_id uuid not null references public.invoices (id),
  unit_seq int not null check (unit_seq between 0 and 12),
  charge_date date not null,
  days_late int not null check (days_late >= 1),
  amount numeric(12, 2) not null check (amount > 0),
  rule_id uuid not null references public.late_fee_rules (id),
  invoice_line_id uuid not null unique references public.invoice_lines (id),
  created_at timestamptz not null default now(),
  unique (invoice_id, unit_seq, charge_date)
);

create index late_fee_charges_institution_id_idx on public.late_fee_charges (institution_id);
create index late_fee_charges_invoice_id_idx on public.late_fee_charges (invoice_id);

create trigger block_mutation
before update or delete on public.late_fee_charges
for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- RLS (07 §2.2, lessons 1/2/7).
-- ---------------------------------------------------------------------------

alter table public.late_fee_rules enable row level security;
alter table public.invoice_instalments enable row level security;
alter table public.late_fee_charges enable row level security;

create policy late_fee_rules_select on public.late_fee_rules
  for select to authenticated
  using (institution_id = any((select app.my_institution_ids(app.finance_roles()))));

create policy late_fee_rules_insert on public.late_fee_rules
  for insert to authenticated
  with check (
    app.has_role(institution_id, app.finance_write_roles())
    and exists (
      select 1 from public.fee_structures fs
      where fs.id = late_fee_rules.fee_structure_id and fs.institution_id = late_fee_rules.institution_id
    )
  );

create policy late_fee_rules_update on public.late_fee_rules
  for update to authenticated
  using (app.has_role(institution_id, app.finance_write_roles()))
  with check (
    app.has_role(institution_id, app.finance_write_roles())
    and exists (
      select 1 from public.fee_structures fs
      where fs.id = late_fee_rules.fee_structure_id and fs.institution_id = late_fee_rules.institution_id
    )
  );

-- invoice_instalments / late_fee_charges: finance roles full read, plus the
-- invoice's own guardian/student scope (same shape as payments_select,
-- 0008). No write policy on either — definer/service-role only.
create policy invoice_instalments_select on public.invoice_instalments
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.finance_roles())))
    or exists (
      select 1 from public.invoices i
      where i.id = invoice_instalments.invoice_id
        and i.institution_id = invoice_instalments.institution_id
        and i.student_id = any((select app.my_student_ids()))
    )
  );

create policy late_fee_charges_select on public.late_fee_charges
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.finance_roles())))
    or exists (
      select 1 from public.invoices i
      where i.id = late_fee_charges.invoice_id
        and i.institution_id = late_fee_charges.institution_id
        and i.student_id = any((select app.my_student_ids()))
    )
  );

-- ---------------------------------------------------------------------------
-- app.invoice_principal(p_invoice_id) — ruling "Principal". Fully revoked
-- (same shape as app.add_invoice_charge, 0086): every caller is a
-- SECURITY DEFINER function that runs as this function's owner, which
-- bypasses the grant check entirely.
-- ---------------------------------------------------------------------------

create function app.invoice_principal(p_invoice_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(il.amount - il.concession_amount), 0)::numeric(12, 2)
  from public.invoice_lines il
  where il.invoice_id = p_invoice_id
    and il.head in ('tuition', 'transport', 'annual_charges', 'admission', 'exam', 'lab_computer', 'activity', 'caution_deposit');
$$;

revoke execute on function app.invoice_principal(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.set_invoice_instalments(...) — ruling "Instalment plans". Single
-- public.* definer (no trusted internal caller needs an unchecked app.*
-- twin — same shape as public.enqueue_term_invoices, 0017). Membership
-- checked before role (app.is_member then app.has_role), same fix-round
-- shape as public.void_payment (0074): a non-member gets not_found, a
-- same-institution caller without the role gets forbidden.
-- ---------------------------------------------------------------------------

create function public.set_invoice_instalments(p_invoice_id uuid, p_parts jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution_id uuid;
  v_invoice public.invoices;
  v_academic_year public.academic_years;
  v_principal numeric(12, 2);
  v_part jsonb;
  v_count int;
  v_i int;
  v_due_on date;
  v_amount numeric(12, 2);
  v_prev_due date;
  v_sum numeric(12, 2) := 0;
  v_has_charge boolean;
  v_previous_parts jsonb;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select institution_id into v_institution_id from public.invoices where id = p_invoice_id;
  if v_institution_id is null or not app.is_member(v_institution_id) then
    raise exception 'code:not_found' using detail = 'invoice not found';
  end if;

  if not app.has_role(v_institution_id, app.finance_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold a finance.plan.manage role for this institution';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;

  if v_invoice.status not in ('issued', 'part_paid') then
    raise exception 'code:invalid_state' using detail = 'invoice is not issued or part_paid';
  end if;

  select exists(select 1 from public.late_fee_charges where invoice_id = p_invoice_id) into v_has_charge;
  if v_has_charge then
    raise exception 'code:invalid_state' using detail = 'plan is locked: invoice already has a late fee charge';
  end if;

  select * into v_academic_year from public.academic_years where id = v_invoice.academic_year_id;

  if jsonb_typeof(p_parts) is distinct from 'array' then
    raise exception 'code:validation_failed' using detail = 'parts must be a JSON array';
  end if;

  v_count := jsonb_array_length(p_parts);
  if v_count < 2 or v_count > 12 then
    raise exception 'code:validation_failed' using detail = 'parts must have between 2 and 12 entries';
  end if;

  v_prev_due := v_invoice.due_on;

  for v_i in 0..v_count - 1 loop
    v_part := p_parts -> v_i;
    v_due_on := (v_part ->> 'due_on')::date;
    v_amount := (v_part ->> 'amount')::numeric(12, 2);

    if v_due_on is null or v_amount is null then
      raise exception 'code:validation_failed' using detail = 'each part needs due_on and amount';
    end if;

    if v_amount < 1.00 or round(v_amount, 2) <> v_amount then
      raise exception 'code:validation_failed' using detail = 'each part amount must be at least 1.00 with at most 2 decimals';
    end if;

    if v_i = 0 then
      if v_due_on < v_invoice.due_on then
        raise exception 'code:validation_failed' using detail = 'first part due_on must be on or after the invoice due date';
      end if;
    elsif v_due_on <= v_prev_due then
      raise exception 'code:validation_failed' using detail = 'part due dates must strictly increase';
    end if;

    v_prev_due := v_due_on;
    v_sum := v_sum + v_amount;
  end loop;

  if v_due_on > v_academic_year.ends_on then
    raise exception 'code:validation_failed' using detail = 'last part due_on must be on or before the academic year end';
  end if;

  v_principal := app.invoice_principal(p_invoice_id);
  if v_sum <> v_principal then
    raise exception 'code:validation_failed' using detail = 'parts must sum exactly to the invoice principal';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('seq', seq, 'due_on', due_on, 'amount', amount) order by seq), '[]'::jsonb)
  into v_previous_parts
  from public.invoice_instalments
  where invoice_id = p_invoice_id;

  delete from public.invoice_instalments where invoice_id = p_invoice_id;

  for v_i in 0..v_count - 1 loop
    v_part := p_parts -> v_i;
    insert into public.invoice_instalments (institution_id, invoice_id, seq, due_on, amount, created_by)
    values (
      v_institution_id, p_invoice_id, v_i + 1,
      (v_part ->> 'due_on')::date, (v_part ->> 'amount')::numeric(12, 2),
      app.current_user_id()
    );
  end loop;

  perform app.audit(
    v_institution_id,
    app.current_user_id(),
    'fee_plans.instalments.set',
    'invoice',
    p_invoice_id,
    v_previous_parts,
    p_parts,
    null
  );

  return v_count;
end;
$$;

revoke execute on function public.set_invoice_instalments(uuid, jsonb) from public, anon;
grant execute on function public.set_invoice_instalments(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- public.invoice_instalment_status(...) — ruling "Per-part status is
-- derived, never stored". security invoker + set search_path = '': RLS on
-- invoice_instalments/invoices decides what the caller actually sees.
-- ---------------------------------------------------------------------------

create function public.invoice_instalment_status(
  p_institution_id uuid,
  p_term_id uuid default null,
  p_invoice_id uuid default null
)
returns table (
  invoice_id uuid,
  seq int,
  due_on date,
  amount numeric,
  paid_amount numeric,
  status text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with parts as (
    select
      i.id as invoice_id,
      ii.seq,
      ii.due_on,
      ii.amount,
      i.paid_total,
      coalesce(inst.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') as tz,
      coalesce((
        select sum(ii2.amount) from public.invoice_instalments ii2
        where ii2.invoice_id = ii.invoice_id and ii2.seq < ii.seq
      ), 0) as earlier_amount
    from public.invoice_instalments ii
    join public.invoices i on i.id = ii.invoice_id
    join public.institutions inst on inst.id = i.institution_id
    where i.institution_id = p_institution_id
      and i.status <> 'cancelled'
      and (p_term_id is null or i.term_id = p_term_id)
      and (p_invoice_id is null or i.id = p_invoice_id)
  ),
  computed as (
    select
      invoice_id, seq, due_on, amount,
      least(amount, greatest(0, paid_total - earlier_amount)) as paid_amount,
      (now() at time zone tz)::date as today
    from parts
  )
  select
    invoice_id, seq, due_on, amount, paid_amount,
    case
      when paid_amount = amount then 'paid'
      when (amount - paid_amount) > 0 and due_on < today then 'overdue'
      when paid_amount > 0 then 'part_paid'
      else 'due'
    end as status
  from computed
  order by invoice_id, seq;
$$;

revoke execute on function public.invoice_instalment_status(uuid, uuid, uuid) from public, anon;
grant execute on function public.invoice_instalment_status(uuid, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- app.module_catalog row (MOD, 0084) + app.module_enabled re-create (see
-- file header for why the re-create is necessary despite the X04-tasks.md
-- ruling's "never redefined" phrasing: 0084 hardcodes `requires` per key
-- and explicitly documents this exact upgrade path).
-- ---------------------------------------------------------------------------

insert into app.module_catalog (key, default_enabled) values ('fee_plans', true)
on conflict (key) do update set default_enabled = excluded.default_enabled;

create or replace function app.module_enabled(p_institution_id uuid, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_default boolean;
  v_raw text;
  v_stored boolean;
  v_req text;
  v_requires text[] := case p_key
    when 'substitution' then array['staff_attendance', 'timetable']
    when 'online_payments' then array['finance_plus']
    when 'mastery' then array['exams']
    when 'agents' then array['ai_teacher']
    when 'fee_plans' then array['finance_plus']
    else array[]::text[]
  end;
begin
  select default_enabled into v_default from app.module_catalog where key = p_key;
  if not found then
    raise exception 'code:internal' using detail = 'unknown module key';
  end if;

  if p_key in ('core', 'people', 'academic_structure', 'attendance', 'fees', 'notifications') then
    return true;
  end if;

  foreach v_req in array v_requires loop
    if not app.module_enabled(p_institution_id, v_req) then
      return false;
    end if;
  end loop;

  select settings -> 'modules' ->> p_key into v_raw
  from public.institutions
  where id = p_institution_id;

  -- Security review (MEDIUM, 2026-11-03): a stray non-boolean value in
  -- settings.modules.<key> must degrade to the catalog default, same as
  -- isModuleEnabled's defensive read in TS, instead of raising.
  v_stored := case when v_raw in ('true', 'false') then v_raw::boolean else null end;

  return coalesce(v_stored, v_default, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- X04-T4: part 2 of 2 — public.apply_late_fees, public.enqueue_due_late_fees,
-- public.ledger_voucher_lines (rulings "Invoice charge"/"Principal"/
-- "Late-fee semantics"/"late_fee_charges"/"apply_late_fees"/"Nightly"/
-- "Ledger export"). Both apply_late_fees and enqueue_due_late_fees are
-- single public.* definers with no app.* core (same shape as M15's
-- public.enqueue_due_reports, 0077): the only caller is the job runner
-- (service_role), so enforcement is the GRANT/REVOKE below, no internal
-- role check. Charges reach the invoice only through X03's
-- app.add_invoice_charge (0086) — never a second write path.
-- ---------------------------------------------------------------------------

create function public.apply_late_fees(p_institution_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_today date;
  v_invoice public.invoices;
  v_fee_assignment public.fee_assignments;
  v_is_ews boolean;
  v_rule public.late_fee_rules;
  v_principal numeric(12, 2);
  v_unit record;
  v_days_late int;
  v_target numeric(12, 2);
  v_existing numeric(12, 2);
  v_charge_amount numeric(12, 2);
  v_description text;
  v_line_id uuid;
  v_charge_id uuid;
  v_total_charges int := 0;
  v_total_amount numeric(12, 2) := 0;
begin
  if not app.module_enabled(p_institution_id, 'fee_plans') then
    return jsonb_build_object('charges', 0, 'amount', 0);
  end if;

  select coalesce(settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') into v_timezone
  from public.institutions where id = p_institution_id;
  v_today := (now() at time zone v_timezone)::date;

  for v_invoice in
    select * from public.invoices
    where institution_id = p_institution_id
      and status in ('issued', 'part_paid')
      and due_on is not null
    order by id
    for update
  loop
    select * into v_fee_assignment from public.fee_assignments
    where student_id = v_invoice.student_id and academic_year_id = v_invoice.academic_year_id;

    if v_fee_assignment.id is null then
      continue;
    end if;

    select exists(
      select 1 from public.concessions c
      where c.fee_assignment_id = v_fee_assignment.id and c.kind = 'ews_rte'
    ) into v_is_ews;

    if v_is_ews then
      continue;
    end if;

    select * into v_rule from public.late_fee_rules
    where fee_structure_id = v_fee_assignment.fee_structure_id and is_active;

    if v_rule.id is null then
      continue;
    end if;

    v_principal := app.invoice_principal(v_invoice.id);

    -- A unit is the whole invoice (unit_seq 0, no plan) or one instalment
    -- (unit_seq = its seq). The first branch yields a row only when the
    -- invoice has no instalments at all.
    for v_unit in
      select 0 as unit_seq, v_invoice.due_on as due_on, v_principal as threshold
      where not exists (select 1 from public.invoice_instalments where invoice_id = v_invoice.id)
      union all
      select ii.seq, ii.due_on, (
        select sum(ii2.amount) from public.invoice_instalments ii2
        where ii2.invoice_id = ii.invoice_id and ii2.seq <= ii.seq
      )
      from public.invoice_instalments ii
      where ii.invoice_id = v_invoice.id
    loop
      if v_invoice.paid_total >= v_unit.threshold then
        continue; -- unit is paid off; never fined again even if a charge on it is still unpaid
      end if;

      v_days_late := v_today - (v_unit.due_on + v_rule.grace_days);
      if v_days_late < 1 then
        continue;
      end if;

      v_target := case when v_rule.kind = 'flat' then v_rule.amount else least(v_rule.cap, v_rule.amount * v_days_late) end;

      select coalesce(sum(amount), 0) into v_existing
      from public.late_fee_charges
      where invoice_id = v_invoice.id and unit_seq = v_unit.unit_seq;

      v_charge_amount := v_target - v_existing;
      if v_charge_amount <= 0 then
        continue; -- already at (or above, impossible) target for this unit: a top-up rerun adds nothing
      end if;

      v_description := case when v_unit.unit_seq = 0 then 'Late fee' else 'Late fee — instalment ' || v_unit.unit_seq end;
      if v_rule.kind = 'per_day' then
        v_description := v_description || ' (' || v_days_late || ' days)';
      end if;

      v_line_id := app.add_invoice_charge(v_invoice.id, 'late_fee', v_description, v_charge_amount);

      insert into public.late_fee_charges (institution_id, invoice_id, unit_seq, charge_date, days_late, amount, rule_id, invoice_line_id)
      values (p_institution_id, v_invoice.id, v_unit.unit_seq, v_today, v_days_late, v_charge_amount, v_rule.id, v_line_id)
      on conflict (invoice_id, unit_seq, charge_date) do nothing
      returning id into v_charge_id;

      if v_charge_id is not null then
        v_total_charges := v_total_charges + 1;
        v_total_amount := v_total_amount + v_charge_amount;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('charges', v_total_charges, 'amount', v_total_amount);
end;
$$;

revoke execute on function public.apply_late_fees(uuid) from public, anon, authenticated;
grant execute on function public.apply_late_fees(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- public.enqueue_due_late_fees() — ruling "Nightly". One job per
-- institution per local day (idempotency key = institution x local date,
-- same shape as M15's enqueue_due_reports, 0077).
-- ---------------------------------------------------------------------------

create function public.enqueue_due_late_fees()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst record;
  v_tz text;
  v_as_of date;
  v_count int := 0;
begin
  for v_inst in
    select i.id
    from public.institutions i
    where app.module_enabled(i.id, 'fee_plans')
      and exists (select 1 from public.late_fee_rules r where r.institution_id = i.id and r.is_active)
  loop
    select coalesce(settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') into v_tz
    from public.institutions where id = v_inst.id;
    v_as_of := (now() at time zone v_tz)::date;

    perform app.enqueue_job(
      v_inst.id,
      'fee_plans.late_fees',
      jsonb_build_object('as_of', v_as_of),
      'fee_plans.late_fees:' || v_inst.id::text || ':' || v_as_of::text
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.enqueue_due_late_fees() from public, anon, authenticated;
grant execute on function public.enqueue_due_late_fees() to service_role;

-- ---------------------------------------------------------------------------
-- public.ledger_voucher_lines(...) — ruling "Ledger export". security
-- invoker + set search_path = '': ledger_entries RLS (finance roles only)
-- decides what the caller actually sees, same shape as
-- invoice_instalment_status. One row per ledger_entries row; voucher_type/
-- voucher_no/charge_head are derived per voucher group
-- (entry_date, coalesce(payment_id, invoice_id), memo), never stored.
-- Tally/plain CSV layout mapping and the >20,000-row cap are TS (T7).
-- ---------------------------------------------------------------------------

create function public.ledger_voucher_lines(
  p_institution_id uuid,
  p_from date,
  p_to date,
  p_receipts_only boolean default true
)
returns table (
  entry_id uuid,
  entry_date date,
  voucher_type text,
  voucher_no text,
  charge_head text,
  account text,
  debit numeric,
  credit numeric,
  memo text,
  admission_no text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select
      le.id as entry_id,
      le.payment_id,
      le.invoice_id,
      le.account,
      le.debit,
      le.credit,
      le.entry_date,
      le.memo,
      coalesce(le.payment_id, le.invoice_id) as voucher_key
    from public.ledger_entries le
    where le.institution_id = p_institution_id
      and le.entry_date between p_from and p_to
  ),
  typed as (
    select
      b.*,
      r.receipt_no,
      i.invoice_no,
      st.admission_no as admission_no,
      bool_or(b.account in ('cash', 'bank') and b.debit > 0) over (partition by b.entry_date, b.voucher_key, b.memo) as has_cash_debit,
      bool_or(b.account in ('cash', 'bank') and b.credit > 0) over (partition by b.entry_date, b.voucher_key, b.memo) as has_cash_credit
    from base b
    left join public.receipts r on r.payment_id = b.payment_id
    left join public.invoices i on i.id = b.invoice_id
    left join public.students st on st.id = i.student_id
  ),
  resolved as (
    select
      t.*,
      case
        when t.payment_id is not null and t.has_cash_debit then 'Receipt'
        when t.payment_id is not null and t.has_cash_credit then 'Payment'
        else 'Journal'
      end as voucher_type,
      case
        when t.payment_id is null and t.memo like '% invoice %' then split_part(t.memo, ' invoice ', 1)
        else null
      end as charge_head
    from typed t
  )
  select
    r.entry_id,
    r.entry_date,
    r.voucher_type,
    case
      when r.voucher_type in ('Receipt', 'Payment') then r.receipt_no
      when r.charge_head is not null then r.invoice_no || '/' || r.charge_head || '/' || to_char(r.entry_date, 'YYYYMMDD')
      else r.invoice_no
    end as voucher_no,
    r.charge_head,
    r.account,
    r.debit,
    r.credit,
    r.memo,
    r.admission_no
  from resolved r
  where (not p_receipts_only) or r.voucher_type in ('Receipt', 'Payment')
  order by r.entry_date, r.voucher_type, voucher_no, r.debit desc, r.entry_id;
$$;

revoke execute on function public.ledger_voucher_lines(uuid, date, date, boolean) from public, anon;
grant execute on function public.ledger_voucher_lines(uuid, date, date, boolean) to authenticated;
