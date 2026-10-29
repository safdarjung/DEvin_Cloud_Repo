-- T-030: finance tables (fee_structures, fee_components, fee_assignments,
-- concessions, invoices, invoice_lines, payments, receipts, ledger_entries)
-- + immutability + RLS class C (05 §2.6, §5, §6; 07 §2.2 finance.*) + three
-- security-definer functions: app.generate_invoice, app.record_payment,
-- app.enrol_applicant (06 §W4, §W9).
--
-- Role-check placement (deviates from a literal reading of the lead's
-- lesson note, recorded here and in the completion report): the
-- authorization check ("does this caller hold a finance/admissions role")
-- lives in the `public.*` wrapper, not inside the `app.*` function. Reason:
-- `app.enrol_applicant` must call `app.generate_invoice` directly (06 §W4
-- step 5) for the *same* request — same `auth.uid()` JWT context, since
-- SECURITY DEFINER changes execution privilege, not `auth.uid()`. An
-- admissions-role caller legitimately enrolling a student is not a member
-- of `app.finance_roles()`; if `app.generate_invoice` re-checked the role
-- from `current_user_id()` on every call, that internal call would wrongly
-- raise forbidden. Putting the check in `public.generate_invoice` instead
-- means: a direct PostgREST RPC call is role-checked (the real exposure
-- surface, since `app` is never PostgREST-exposed — 05 §5), while
-- `app.enrol_applicant`'s internal call to `app.generate_invoke` is a
-- trusted same-transaction call from another `app.*` function, exactly
-- like `app.assign_application_no` trusting `app.next_sequence` with no
-- re-check (0007's own precedent). Tenant-safety (the actual "never trust a
-- caller-supplied id from another tenant" risk) is still enforced in every
-- `app.*` function below by deriving `institution_id` from the row the
-- caller names (student/invoice/application) and never accepting it as a
-- separate argument to cross-check.

-- ---------------------------------------------------------------------------
-- Tables (05 §2.6). Money columns are numeric(12,2) everywhere; no float
-- arithmetic anywhere in this file.
-- ---------------------------------------------------------------------------

create table public.fee_structures (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  academic_year_id uuid not null references public.academic_years (id),
  grade_id uuid not null references public.grades (id),
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year_id, grade_id, name)
);

create index fee_structures_institution_id_idx on public.fee_structures (institution_id);

create trigger set_updated_at
before update on public.fee_structures
for each row execute function app.set_updated_at();

create table public.fee_components (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  fee_structure_id uuid not null references public.fee_structures (id),
  head text not null check (head in ('tuition', 'transport', 'annual_charges', 'admission', 'exam', 'lab_computer', 'activity', 'caution_deposit')),
  amount numeric(12, 2) not null check (amount >= 0),
  frequency text not null check (frequency in ('one_time', 'annual', 'term', 'quarterly', 'monthly')),
  applies_to_new_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fee_structure_id, head)
);

create index fee_components_institution_id_idx on public.fee_components (institution_id);

create trigger set_updated_at
before update on public.fee_components
for each row execute function app.set_updated_at();

create table public.fee_assignments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  fee_structure_id uuid not null references public.fee_structures (id),
  academic_year_id uuid not null references public.academic_years (id),
  assigned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, academic_year_id)
);

create index fee_assignments_institution_id_idx on public.fee_assignments (institution_id);

create trigger set_updated_at
before update on public.fee_assignments
for each row execute function app.set_updated_at();

create table public.concessions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  fee_assignment_id uuid not null references public.fee_assignments (id),
  kind text not null check (kind in ('sibling', 'staff_ward', 'merit', 'ews_rte', 'hardship', 'other')),
  head text,
  percent numeric(5, 2),
  amount numeric(12, 2),
  approved_by uuid not null references public.profiles (id),
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((percent is null) <> (amount is null))
);

create index concessions_institution_id_idx on public.concessions (institution_id);
create index concessions_fee_assignment_idx on public.concessions (fee_assignment_id);

create trigger set_updated_at
before update on public.concessions
for each row execute function app.set_updated_at();

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  student_id uuid not null references public.students (id),
  academic_year_id uuid not null references public.academic_years (id),
  term_id uuid not null references public.terms (id),
  invoice_no text not null,
  status text not null default 'issued' check (status in ('issued', 'part_paid', 'paid', 'cancelled')),
  subtotal numeric(12, 2) not null default 0,
  concession_total numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  paid_total numeric(12, 2) not null default 0,
  due_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, invoice_no)
);

-- Partial unique rather than a plain unique(student_id, term_id): a
-- cancelled invoice (P1, not built here) must not block regenerating one.
create unique index invoices_one_active_per_student_term_idx on public.invoices (student_id, term_id) where status <> 'cancelled';
create index invoices_status_due_idx on public.invoices (status, due_on);
create index invoices_institution_id_idx on public.invoices (institution_id);

create trigger set_updated_at
before update on public.invoices
for each row execute function app.set_updated_at();

-- invoice_lines: immutable (05 §6) — written only inside app.generate_invoice.
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  invoice_id uuid not null references public.invoices (id),
  head text not null,
  description text not null,
  amount numeric(12, 2) not null,
  concession_amount numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index invoice_lines_invoice_id_idx on public.invoice_lines (invoice_id);
create index invoice_lines_institution_id_idx on public.invoice_lines (institution_id);

create trigger block_mutation
before update or delete on public.invoice_lines
for each row execute function app.block_mutation();

-- payments: immutable (05 §6), revision-audited (05 §6) via the explicit
-- app.audit call inside app.record_payment below — there is no other write
-- path to this table (no INSERT/UPDATE policy; writes are function-only),
-- so a separate row-level audit trigger (like 0003's membership_audit, used
-- there because memberships has several direct writers) would be a second
-- audit of the same single writer. idempotency_key is unique per
-- institution (lead instruction), not globally, so two institutions'
-- cashiers can coincidentally reuse the same client-generated UUID without
-- collision.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  invoice_id uuid not null references public.invoices (id),
  amount numeric(12, 2) not null check (amount > 0),
  mode text not null check (mode in ('cash', 'upi', 'cheque', 'neft', 'card')),
  reference text,
  received_at timestamptz not null,
  received_by uuid references public.profiles (id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (institution_id, idempotency_key)
);

create index payments_invoice_id_idx on public.payments (invoice_id);
create index payments_institution_id_idx on public.payments (institution_id);

create trigger block_mutation
before update or delete on public.payments
for each row execute function app.block_mutation();

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  payment_id uuid not null unique references public.payments (id),
  receipt_no text not null,
  financial_year text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (institution_id, receipt_no)
);

create index receipts_institution_id_idx on public.receipts (institution_id);

create trigger block_mutation
before update or delete on public.receipts
for each row execute function app.block_mutation();

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  payment_id uuid references public.payments (id),
  invoice_id uuid references public.invoices (id),
  account text not null check (account in ('fees_receivable', 'cash', 'bank', 'fee_income', 'concession_expense')),
  debit numeric(12, 2) not null default 0,
  credit numeric(12, 2) not null default 0,
  entry_date date not null,
  memo text,
  created_at timestamptz not null default now(),
  check ((debit = 0) <> (credit = 0))
);

create index ledger_entries_institution_date_idx on public.ledger_entries (institution_id, entry_date);

create trigger block_mutation
before update or delete on public.ledger_entries
for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- RLS (05 §5 class C; 07 §2.2). Config tables (fee_structures/fee_components/
-- fee_assignments/concessions) get direct writes by app.finance_roles(),
-- same-institution FK checks in `with check` (lesson #2). Money-movement
-- tables (invoices/invoice_lines/payments/receipts/ledger_entries) get NO
-- insert/update policy at all — written only by the two definer functions
-- below, which run as the function owner and bypass RLS regardless (same
-- shape as audit_events/jobs having no matching policy). invoices/
-- invoice_lines/payments/receipts additionally allow guardian/student
-- own-scope SELECT (05 §5: "guardian own-scope where stated — invoices,
-- payments, receipts"); fee_structures/fee_components/fee_assignments/
-- concessions/ledger_entries do not (not in that list).
-- ---------------------------------------------------------------------------

alter table public.fee_structures enable row level security;
alter table public.fee_components enable row level security;
alter table public.fee_assignments enable row level security;
alter table public.concessions enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;
alter table public.receipts enable row level security;
alter table public.ledger_entries enable row level security;

create policy fee_structures_select on public.fee_structures
  for select to authenticated
  using (app.has_role(institution_id, app.finance_roles()));

create policy fee_structures_insert on public.fee_structures
  for insert to authenticated
  with check (
    app.has_role(institution_id, app.finance_roles())
    and exists (select 1 from public.academic_years y where y.id = fee_structures.academic_year_id and y.institution_id = fee_structures.institution_id)
    and exists (select 1 from public.grades g where g.id = fee_structures.grade_id and g.institution_id = fee_structures.institution_id)
  );

create policy fee_structures_update on public.fee_structures
  for update to authenticated
  using (app.has_role(institution_id, app.finance_roles()))
  with check (
    app.has_role(institution_id, app.finance_roles())
    and exists (select 1 from public.academic_years y where y.id = fee_structures.academic_year_id and y.institution_id = fee_structures.institution_id)
    and exists (select 1 from public.grades g where g.id = fee_structures.grade_id and g.institution_id = fee_structures.institution_id)
  );

create policy fee_components_select on public.fee_components
  for select to authenticated
  using (app.has_role(institution_id, app.finance_roles()));

create policy fee_components_insert on public.fee_components
  for insert to authenticated
  with check (
    app.has_role(institution_id, app.finance_roles())
    and exists (select 1 from public.fee_structures s where s.id = fee_components.fee_structure_id and s.institution_id = fee_components.institution_id)
  );

create policy fee_components_update on public.fee_components
  for update to authenticated
  using (app.has_role(institution_id, app.finance_roles()))
  with check (
    app.has_role(institution_id, app.finance_roles())
    and exists (select 1 from public.fee_structures s where s.id = fee_components.fee_structure_id and s.institution_id = fee_components.institution_id)
  );

create policy fee_assignments_select on public.fee_assignments
  for select to authenticated
  using (app.has_role(institution_id, app.finance_roles()));

create policy fee_assignments_insert on public.fee_assignments
  for insert to authenticated
  with check (
    app.has_role(institution_id, app.finance_roles())
    and exists (select 1 from public.students st where st.id = fee_assignments.student_id and st.institution_id = fee_assignments.institution_id)
    and exists (select 1 from public.fee_structures s where s.id = fee_assignments.fee_structure_id and s.institution_id = fee_assignments.institution_id)
  );

create policy fee_assignments_update on public.fee_assignments
  for update to authenticated
  using (app.has_role(institution_id, app.finance_roles()))
  with check (
    app.has_role(institution_id, app.finance_roles())
    and exists (select 1 from public.students st where st.id = fee_assignments.student_id and st.institution_id = fee_assignments.institution_id)
    and exists (select 1 from public.fee_structures s where s.id = fee_assignments.fee_structure_id and s.institution_id = fee_assignments.institution_id)
  );

create policy concessions_select on public.concessions
  for select to authenticated
  using (app.has_role(institution_id, app.finance_roles()));

create policy concessions_insert on public.concessions
  for insert to authenticated
  with check (
    app.has_role(institution_id, app.finance_roles())
    and exists (select 1 from public.fee_assignments a where a.id = concessions.fee_assignment_id and a.institution_id = concessions.institution_id)
  );

create policy concessions_update on public.concessions
  for update to authenticated
  using (app.has_role(institution_id, app.finance_roles()))
  with check (
    app.has_role(institution_id, app.finance_roles())
    and exists (select 1 from public.fee_assignments a where a.id = concessions.fee_assignment_id and a.institution_id = concessions.institution_id)
  );

-- invoices/invoice_lines/payments/receipts: SELECT only (no direct writes
-- at all). app.finance_roles() full read; guardian/student own-scope.
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    app.has_role(institution_id, app.finance_roles())
    or student_id in (select app.guardian_student_ids(institution_id))
    or student_id = app.own_student_id(institution_id)
  );

create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (
    app.has_role(institution_id, app.finance_roles())
    or exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and i.institution_id = invoice_lines.institution_id
        and (
          i.student_id in (select app.guardian_student_ids(invoice_lines.institution_id))
          or i.student_id = app.own_student_id(invoice_lines.institution_id)
        )
    )
  );

create policy payments_select on public.payments
  for select to authenticated
  using (
    app.has_role(institution_id, app.finance_roles())
    or exists (
      select 1 from public.invoices i
      where i.id = payments.invoice_id
        and i.institution_id = payments.institution_id
        and (
          i.student_id in (select app.guardian_student_ids(payments.institution_id))
          or i.student_id = app.own_student_id(payments.institution_id)
        )
    )
  );

create policy receipts_select on public.receipts
  for select to authenticated
  using (
    app.has_role(institution_id, app.finance_roles())
    or exists (
      select 1 from public.payments p
      join public.invoices i on i.id = p.invoice_id
      where p.id = receipts.payment_id
        and p.institution_id = receipts.institution_id
        and (
          i.student_id in (select app.guardian_student_ids(receipts.institution_id))
          or i.student_id = app.own_student_id(receipts.institution_id)
        )
    )
  );

-- ledger_entries: finance_roles() only — not in 05 §5's guardian-scope list.
create policy ledger_entries_select on public.ledger_entries
  for select to authenticated
  using (app.has_role(institution_id, app.finance_roles()));

-- ---------------------------------------------------------------------------
-- Fix round 1 (security review, CRITICAL): app.finance_roles() (0001) =
-- owner/principal/admin/accountant — correct for RLS reads/structure writes
-- above (07 §2.2 finance.structure.manage includes admin), but
-- finance.invoice.generate and finance.payment.record do NOT include admin.
-- A separate, narrower role set for those two money-movement actions, same
-- style/grants as app.finance_roles().
-- ---------------------------------------------------------------------------

create function app.finance_write_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['owner', 'principal', 'accountant'];
$$;

revoke execute on function app.finance_write_roles() from public;
grant execute on function app.finance_write_roles() to authenticated;

-- ---------------------------------------------------------------------------
-- app.generate_invoice(student_id, term_id) — 06 §W9. Idempotent per
-- (student_id, term_id). Proration (one_time/annual only in Term 1 or at the
-- student's first-ever invoice; term components every term; monthly x6 and
-- quarterly x2 per term) is exactly 06 §W9's stated rule, not derived from
-- actual month/quarter counts.
--
-- shortcut: a concession row with a null `head` (whole-invoice concession)
-- is not applied — only concessions whose `head` matches a fee_component's
-- head are deducted. Upgrade when a demo scenario needs a whole-invoice
-- concession (none does today: 05 §8.1 lists no concession fixture).
-- ---------------------------------------------------------------------------

create function app.generate_invoice(p_student_id uuid, p_term_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_term public.terms;
  v_institution_id uuid;
  v_existing_id uuid;
  v_fee_assignment public.fee_assignments;
  v_is_first_invoice boolean;
  v_is_term1 boolean;
  v_timezone text;
  v_fy_start_month int;
  v_today date;
  v_fy_start_year int;
  v_fy text;
  v_due_day int;
  v_due_on date;
  v_invoice_id uuid;
  v_invoice_no text;
  v_subtotal numeric(12, 2) := 0;
  v_concession_total numeric(12, 2) := 0;
  v_component record;
  v_multiplier int;
  v_line_amount numeric(12, 2);
  v_concession_amount numeric(12, 2);
begin
  select * into v_student from public.students where id = p_student_id;
  if v_student.id is null then
    raise exception 'code:not_found' using detail = 'student not found';
  end if;

  select * into v_term from public.terms where id = p_term_id;
  if v_term.id is null then
    raise exception 'code:not_found' using detail = 'term not found';
  end if;

  if v_term.institution_id <> v_student.institution_id then
    raise exception 'code:validation_failed' using detail = 'term does not belong to the student''s institution';
  end if;

  v_institution_id := v_student.institution_id;

  -- Idempotent on (student_id, term_id) — the partial unique index also
  -- enforces this at the DB level; this check just avoids relying on a
  -- caught unique-violation for the common case.
  select id into v_existing_id
  from public.invoices
  where student_id = p_student_id and term_id = p_term_id and status <> 'cancelled';

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select * into v_fee_assignment
  from public.fee_assignments
  where student_id = p_student_id and academic_year_id = v_term.academic_year_id;

  if v_fee_assignment.id is null then
    raise exception 'code:not_found' using detail = 'no fee assignment for this student in the term''s academic year';
  end if;

  select not exists (select 1 from public.invoices where student_id = p_student_id)
    into v_is_first_invoice;
  v_is_term1 := v_term.sequence = 1;

  select coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'),
         coalesce((i.settings -> 'finance' ->> 'financial_year_start_month')::int, 4),
         coalesce((i.settings -> 'finance' ->> 'default_due_day')::int, 10)
  into v_timezone, v_fy_start_month, v_due_day
  from public.institutions i
  where i.id = v_institution_id;

  v_today := (now() at time zone v_timezone)::date;
  if extract(month from v_today) >= v_fy_start_month then
    v_fy_start_year := extract(year from v_today)::int;
  else
    v_fy_start_year := extract(year from v_today)::int - 1;
  end if;
  v_fy := v_fy_start_year::text || '-' || lpad(((v_fy_start_year + 1) % 100)::text, 2, '0');

  v_due_on := v_term.starts_on + v_due_day;
  v_invoice_no := app.next_sequence(v_institution_id, 'invoice_no:' || v_fy);

  -- Insert the invoice row first (placeholder totals) so invoice_lines'
  -- FK is satisfied; totals are filled in by the UPDATE after the loop.
  insert into public.invoices (
    id, institution_id, student_id, academic_year_id, term_id, invoice_no, status,
    subtotal, concession_total, total, paid_total, due_on
  ) values (
    gen_random_uuid(), v_institution_id, p_student_id, v_term.academic_year_id, p_term_id, v_invoice_no, 'issued',
    0, 0, 0, 0, v_due_on
  )
  returning id into v_invoice_id;

  for v_component in
    select * from public.fee_components where fee_structure_id = v_fee_assignment.fee_structure_id
  loop
    v_multiplier := case v_component.frequency
      when 'one_time' then (case when v_is_first_invoice then 1 else 0 end)
      when 'annual' then (case when v_is_term1 or v_is_first_invoice then 1 else 0 end)
      when 'term' then 1
      when 'quarterly' then 2
      when 'monthly' then 6
      else 0
    end;

    if v_multiplier = 0 then
      continue;
    end if;

    v_line_amount := v_component.amount * v_multiplier;

    select coalesce(sum(
      case
        when c.percent is not null then round(v_line_amount * c.percent / 100, 2)
        else least(c.amount, v_line_amount)
      end
    ), 0)
    into v_concession_amount
    from public.concessions c
    where c.fee_assignment_id = v_fee_assignment.id and c.head = v_component.head;

    insert into public.invoice_lines (institution_id, invoice_id, head, description, amount, concession_amount)
    values (v_institution_id, v_invoice_id, v_component.head, v_component.head || ' (' || v_component.frequency || ')', v_line_amount, v_concession_amount);

    v_subtotal := v_subtotal + v_line_amount;
    v_concession_total := v_concession_total + v_concession_amount;
  end loop;

  update public.invoices
  set subtotal = v_subtotal, concession_total = v_concession_total, total = v_subtotal - v_concession_total
  where id = v_invoice_id;

  -- Ledger (06 §W9): Dr fees_receivable (net) + Dr concession_expense
  -- (concession) = Cr fee_income (gross) — balances because
  -- total = subtotal - concession_total.
  insert into public.ledger_entries (institution_id, invoice_id, account, debit, credit, entry_date, memo)
  values (v_institution_id, v_invoice_id, 'fees_receivable', v_subtotal - v_concession_total, 0, v_today, 'invoice ' || v_invoice_no);

  insert into public.ledger_entries (institution_id, invoice_id, account, debit, credit, entry_date, memo)
  values (v_institution_id, v_invoice_id, 'fee_income', 0, v_subtotal, v_today, 'invoice ' || v_invoice_no);

  if v_concession_total > 0 then
    insert into public.ledger_entries (institution_id, invoice_id, account, debit, credit, entry_date, memo)
    values (v_institution_id, v_invoice_id, 'concession_expense', v_concession_total, 0, v_today, 'invoice ' || v_invoice_no);
  end if;

  perform app.audit(
    v_institution_id,
    app.current_user_id(),
    'finance.invoice.generated',
    'invoice',
    v_invoice_id,
    null,
    jsonb_build_object('invoice_no', v_invoice_no, 'subtotal', v_subtotal, 'concession_total', v_concession_total, 'total', v_subtotal - v_concession_total),
    jsonb_build_object('student_id', p_student_id, 'term_id', p_term_id)
  );

  return v_invoice_id;
end;
$$;

revoke execute on function app.generate_invoice(uuid, uuid) from public, anon, authenticated;

create function public.generate_invoice(p_student_id uuid, p_term_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution_id uuid;
begin
  -- Role check lives here, not in app.generate_invoice (see file header):
  -- a null auth.uid() means this is a trusted internal/service-role caller
  -- (the T-031 job, or app.enrol_applicant's internal call by way of this
  -- same reasoning not applying — enrol_applicant calls app.generate_invoice
  -- directly, never this wrapper).
  if app.current_user_id() is not null then
    select institution_id into v_institution_id from public.students where id = p_student_id;
    -- Fix round 1 (CRITICAL): finance.invoice.generate (07 §2.2) is
    -- owner/principal/accountant — admin is NOT in that row, unlike
    -- app.finance_roles() used for RLS reads.
    if v_institution_id is null or not app.has_role(v_institution_id, app.finance_write_roles()) then
      raise exception 'code:forbidden' using detail = 'caller does not hold a finance.invoice.generate role for this student''s institution';
    end if;
  end if;

  return app.generate_invoice(p_student_id, p_term_id);
end;
$$;

revoke execute on function public.generate_invoice(uuid, uuid) from public, anon;
grant execute on function public.generate_invoice(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- app.record_payment(...) — 06 §W9. Locks the invoice row; the idempotency
-- fast-path returns before re-validating amount-vs-outstanding (replaying a
-- successful payment must not re-check against an outstanding balance that
-- payment already reduced). A genuine concurrent double-submit is still
-- closed by `on conflict (institution_id, idempotency_key) do nothing` —
-- the loser re-reads and returns the winner's result instead of erroring.
-- ---------------------------------------------------------------------------

create function app.record_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_mode text,
  p_reference text,
  p_received_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_institution_id uuid;
  v_outstanding numeric(12, 2);
  v_payment_id uuid;
  v_receipt_id uuid;
  v_receipt_no text;
  v_timezone text;
  v_fy_start_month int;
  v_today date;
  v_fy_start_year int;
  v_fy text;
  v_new_paid_total numeric(12, 2);
  v_new_status text;
  v_account text;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'code:not_found' using detail = 'invoice not found';
  end if;

  v_institution_id := v_invoice.institution_id;

  -- Idempotent fast path: a replay of an already-recorded payment returns
  -- the existing payment/receipt without touching the invoice or ledger again.
  select p.id, r.id, r.receipt_no into v_payment_id, v_receipt_id, v_receipt_no
  from public.payments p
  join public.receipts r on r.payment_id = p.id
  where p.institution_id = v_institution_id and p.idempotency_key = p_idempotency_key;

  if v_payment_id is not null then
    return jsonb_build_object('payment_id', v_payment_id, 'receipt_id', v_receipt_id, 'receipt_no', v_receipt_no);
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'code:validation_failed' using detail = 'amount must be greater than zero';
  end if;

  if p_received_at > now() + interval '1 minute' then
    raise exception 'code:validation_failed' using detail = 'receivedAt may not be in the future';
  end if;

  v_outstanding := v_invoice.total - v_invoice.paid_total;
  if p_amount > v_outstanding then
    raise exception 'code:validation_failed' using detail = 'amount exceeds the invoice''s outstanding balance';
  end if;

  select coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata'),
         coalesce((i.settings -> 'finance' ->> 'financial_year_start_month')::int, 4)
  into v_timezone, v_fy_start_month
  from public.institutions i
  where i.id = v_institution_id;

  v_today := (now() at time zone v_timezone)::date;
  if extract(month from v_today) >= v_fy_start_month then
    v_fy_start_year := extract(year from v_today)::int;
  else
    v_fy_start_year := extract(year from v_today)::int - 1;
  end if;
  v_fy := v_fy_start_year::text || '-' || lpad(((v_fy_start_year + 1) % 100)::text, 2, '0');

  insert into public.payments (institution_id, invoice_id, amount, mode, reference, received_at, received_by, idempotency_key)
  values (v_institution_id, p_invoice_id, p_amount, p_mode, p_reference, p_received_at, app.current_user_id(), p_idempotency_key)
  on conflict (institution_id, idempotency_key) do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    -- Lost the race to a concurrent call with the same key: return the winner's result.
    select p.id, r.id, r.receipt_no into v_payment_id, v_receipt_id, v_receipt_no
    from public.payments p
    join public.receipts r on r.payment_id = p.id
    where p.institution_id = v_institution_id and p.idempotency_key = p_idempotency_key;

    return jsonb_build_object('payment_id', v_payment_id, 'receipt_id', v_receipt_id, 'receipt_no', v_receipt_no);
  end if;

  v_receipt_no := app.next_sequence(v_institution_id, 'receipt_no:' || v_fy);

  insert into public.receipts (institution_id, payment_id, receipt_no, financial_year, snapshot)
  values (
    v_institution_id, v_payment_id, v_receipt_no, v_fy,
    jsonb_build_object(
      'invoice_id', p_invoice_id,
      'student_id', v_invoice.student_id,
      'amount', p_amount,
      'mode', p_mode,
      'reference', p_reference,
      'received_at', p_received_at,
      'heads', (
        select coalesce(jsonb_agg(jsonb_build_object('head', l.head, 'amount', l.amount, 'concession_amount', l.concession_amount)), '[]'::jsonb)
        from public.invoice_lines l
        where l.invoice_id = p_invoice_id
      )
    )
  )
  returning id into v_receipt_id;

  v_new_paid_total := v_invoice.paid_total + p_amount;
  v_new_status := case when v_new_paid_total >= v_invoice.total then 'paid' else 'part_paid' end;

  update public.invoices
  set paid_total = v_new_paid_total, status = v_new_status
  where id = p_invoice_id;

  v_account := case when p_mode = 'cash' then 'cash' else 'bank' end;

  insert into public.ledger_entries (institution_id, payment_id, invoice_id, account, debit, credit, entry_date, memo)
  values (v_institution_id, v_payment_id, p_invoice_id, v_account, p_amount, 0, v_today, 'receipt ' || v_receipt_no);

  insert into public.ledger_entries (institution_id, payment_id, invoice_id, account, debit, credit, entry_date, memo)
  values (v_institution_id, v_payment_id, p_invoice_id, 'fees_receivable', 0, p_amount, v_today, 'receipt ' || v_receipt_no);

  perform app.audit(
    v_institution_id,
    app.current_user_id(),
    'finance.payment.recorded',
    'payment',
    v_payment_id,
    null,
    jsonb_build_object('amount', p_amount, 'mode', p_mode, 'receipt_no', v_receipt_no),
    jsonb_build_object('invoice_id', p_invoice_id)
  );

  return jsonb_build_object('payment_id', v_payment_id, 'receipt_id', v_receipt_id, 'receipt_no', v_receipt_no);
end;
$$;

revoke execute on function app.record_payment(uuid, numeric, text, text, timestamptz, text) from public, anon, authenticated;

create function public.record_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_mode text,
  p_reference text,
  p_received_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select institution_id into v_institution_id from public.invoices where id = p_invoice_id;
  -- Fix round 1 (CRITICAL): finance.payment.record (07 §2.2) is
  -- owner/principal/accountant — admin is NOT in that row.
  if v_institution_id is null or not app.has_role(v_institution_id, app.finance_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold a finance.payment.record role for this invoice''s institution';
  end if;

  return app.record_payment(p_invoice_id, p_amount, p_mode, p_reference, p_received_at, p_idempotency_key);
end;
$$;

revoke execute on function public.record_payment(uuid, numeric, text, text, timestamptz, text) from public, anon;
grant execute on function public.record_payment(uuid, numeric, text, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Fix round 1 (security review, HIGH / DBT-20): applications_update (0007)
-- allows any column update, so a direct `update applications set
-- status='enrolled'` (no student, no invoice, no audit — the application
-- stuck looking "done") bypassed app.enrol_applicant entirely. 0007 is
-- merged and is never edited (CLAUDE.md rule 9); this BEFORE UPDATE
-- trigger lands here instead and blocks any write that moves `status` to
-- `enrolled` unless `app.allow_enrol` is set for the current transaction —
-- same pattern as 0010's `app.allow_publish` for `publish_page`. A PostgREST
-- caller cannot set a GUC (T-023's review already verified `set_config`
-- isn't exposed), so only app.enrol_applicant's own `perform
-- set_config('app.allow_enrol', 'on', true)` immediately before its own
-- status update can ever produce an `enrolled` row through UPDATE.
-- `security definer`/`search_path=''`/qualified names per 07 §4.
--
-- Seed note: the seed (T-033, not yet landing finance/admissions data as of
-- this packet) runs as service_role and would insert applications directly;
-- an INSERT is never gated by this trigger (BEFORE UPDATE only) — a seed
-- that wants an already-`enrolled` application fixture can insert it with
-- that status directly, no GUC needed.
-- ---------------------------------------------------------------------------

create function app.guard_application_enrolled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'enrolled' and old.status <> 'enrolled' and coalesce(current_setting('app.allow_enrol', true), '') <> 'on' then
    raise exception 'code:invalid_state' using detail = 'applications.status may only become enrolled through app.enrol_applicant';
  end if;
  return new;
end;
$$;

revoke execute on function app.guard_application_enrolled() from public;

create trigger guard_application_enrolled
before update on public.applications
for each row execute function app.guard_application_enrolled();

-- ---------------------------------------------------------------------------
-- app.enrol_applicant(...) — 06 §W4 steps 1-6 in one transaction. Locks the
-- application first (serializes double-click), then the class_section
-- (serializes the capacity race). Calls app.generate_invoice directly
-- (same transaction, no role re-check — see file header).
-- ---------------------------------------------------------------------------

create function app.enrol_applicant(
  p_application_id uuid,
  p_class_section_id uuid,
  p_fee_structure_id uuid,
  p_roll_no int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.applications;
  v_institution_id uuid;
  v_existing_student_id uuid;
  v_existing_admission_no text;
  v_section public.class_sections;
  v_active_count int;
  v_admission_no text;
  v_student_id uuid;
  v_guardian_id uuid;
  v_guardian_phone text;
  v_enrolment_id uuid;
  v_roll_no int;
  v_timezone text;
  v_term_id uuid;
  v_invoice_id uuid;
begin
  select * into v_application from public.applications where id = p_application_id for update;
  if v_application.id is null then
    raise exception 'code:not_found' using detail = 'application not found';
  end if;

  v_institution_id := v_application.institution_id;

  if v_application.status = 'enrolled' then
    select id, admission_no into v_existing_student_id, v_existing_admission_no
    from public.students
    where source_application_id = p_application_id;

    return jsonb_build_object(
      'student_id', v_existing_student_id,
      'admission_no', v_existing_admission_no,
      'already_enrolled', true
    );
  end if;

  if v_application.status <> 'accepted' then
    raise exception 'code:invalid_state' using detail = format('application must be accepted to enrol; current status is %s', v_application.status);
  end if;

  select * into v_section from public.class_sections where id = p_class_section_id and institution_id = v_institution_id for update;
  if v_section.id is null then
    raise exception 'code:not_found' using detail = 'class section not found for this institution';
  end if;

  if v_section.grade_id <> v_application.grade_applied_id or v_section.academic_year_id <> v_application.academic_year_id then
    raise exception 'code:validation_failed' using detail = 'class section does not match the application''s grade and academic year';
  end if;

  if not exists (
    select 1 from public.fee_structures s
    where s.id = p_fee_structure_id and s.institution_id = v_institution_id
      and s.grade_id = v_application.grade_applied_id and s.academic_year_id = v_application.academic_year_id
  ) then
    raise exception 'code:validation_failed' using detail = 'fee structure does not match the application''s grade and academic year';
  end if;

  select count(*) into v_active_count from public.enrolments where class_section_id = p_class_section_id and status = 'active';
  if v_section.capacity is not null and v_active_count >= v_section.capacity then
    raise exception 'code:conflict' using detail = 'class section is at capacity';
  end if;

  v_admission_no := app.next_sequence(v_institution_id, 'admission_no');

  insert into public.students (institution_id, admission_no, first_name, last_name, dob, gender, status, source_application_id)
  values (
    v_institution_id, v_admission_no,
    v_application.applicant ->> 'firstName',
    v_application.applicant ->> 'lastName',
    (v_application.applicant ->> 'dob')::date,
    v_application.applicant ->> 'gender',
    'active',
    p_application_id
  )
  returning id into v_student_id;

  v_guardian_phone := v_application.guardian ->> 'phone';

  select id into v_guardian_id from public.guardians where institution_id = v_institution_id and phone = v_guardian_phone;

  if v_guardian_id is null then
    insert into public.guardians (institution_id, full_name, phone, email)
    values (v_institution_id, v_application.guardian ->> 'fullName', v_guardian_phone, v_application.guardian ->> 'email')
    returning id into v_guardian_id;
  end if;

  insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
  values (v_institution_id, v_guardian_id, v_student_id, coalesce(v_application.guardian ->> 'relationship', 'other'), true, true);

  if p_roll_no is not null then
    v_roll_no := p_roll_no;
  else
    select coalesce(max(roll_no), 0) + 1 into v_roll_no from public.enrolments where class_section_id = p_class_section_id and status = 'active';
  end if;

  select coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') into v_timezone
  from public.institutions i where i.id = v_institution_id;

  insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, roll_no, status, started_on)
  values (v_institution_id, v_student_id, p_class_section_id, v_application.academic_year_id, v_roll_no, 'active', (now() at time zone v_timezone)::date)
  returning id into v_enrolment_id;

  -- app.enrolment_status_changed (0005) only fires on UPDATE; this is the
  -- row's first (INSERT) history entry.
  insert into public.enrolment_status_history (institution_id, enrolment_id, from_status, to_status, changed_by)
  values (v_institution_id, v_enrolment_id, null, 'active', app.current_user_id());

  insert into public.fee_assignments (institution_id, student_id, fee_structure_id, academic_year_id, assigned_by)
  values (v_institution_id, v_student_id, p_fee_structure_id, v_application.academic_year_id, app.current_user_id());

  -- Assumption (recorded in the completion report): "current term" = the
  -- term containing today (institution-local date) in the institution's
  -- current academic year; if none matches, the latest term by sequence.
  select t.id into v_term_id
  from public.terms t
  join public.academic_years y on y.id = t.academic_year_id
  where y.institution_id = v_institution_id and y.is_current
    and (now() at time zone v_timezone)::date between t.starts_on and t.ends_on
  order by t.sequence
  limit 1;

  if v_term_id is null then
    select t.id into v_term_id
    from public.terms t
    join public.academic_years y on y.id = t.academic_year_id
    where y.institution_id = v_institution_id and y.is_current
    order by t.sequence desc
    limit 1;
  end if;

  if v_term_id is null then
    raise exception 'code:invalid_state' using detail = 'no term configured for the current academic year';
  end if;

  v_invoice_id := app.generate_invoice(v_student_id, v_term_id);

  -- Fix round 1 (HIGH): app.guard_application_enrolled blocks this UPDATE
  -- unless the GUC is set for this transaction (same shape as 0010's
  -- app.allow_publish).
  perform set_config('app.allow_enrol', 'on', true);
  update public.applications set status = 'enrolled' where id = p_application_id;

  perform app.audit(
    v_institution_id,
    app.current_user_id(),
    'admissions.enrolled',
    'application',
    p_application_id,
    jsonb_build_object('status', 'accepted'),
    jsonb_build_object('status', 'enrolled'),
    jsonb_build_object('student_id', v_student_id, 'guardian_id', v_guardian_id, 'enrolment_id', v_enrolment_id, 'invoice_id', v_invoice_id)
  );

  perform app.enqueue_job(
    v_institution_id,
    'notify.enrolment_welcome',
    jsonb_build_object('student_id', v_student_id, 'guardian_id', v_guardian_id, 'application_id', p_application_id),
    'enrol:' || p_application_id
  );

  return jsonb_build_object(
    'student_id', v_student_id,
    'admission_no', v_admission_no,
    'guardian_id', v_guardian_id,
    'enrolment_id', v_enrolment_id,
    'invoice_id', v_invoice_id,
    'already_enrolled', false
  );
end;
$$;

revoke execute on function app.enrol_applicant(uuid, uuid, uuid, int) from public, anon, authenticated;

create function public.enrol_applicant(
  p_application_id uuid,
  p_class_section_id uuid,
  p_fee_structure_id uuid,
  p_roll_no int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select institution_id into v_institution_id from public.applications where id = p_application_id;
  if v_institution_id is null or not app.has_role(v_institution_id, array['owner', 'principal', 'admin', 'admissions']) then
    raise exception 'code:forbidden' using detail = 'caller does not hold an admissions.enrol role for this application''s institution';
  end if;

  return app.enrol_applicant(p_application_id, p_class_section_id, p_fee_structure_id, p_roll_no);
end;
$$;

revoke execute on function public.enrol_applicant(uuid, uuid, uuid, int) from public, anon;
grant execute on function public.enrol_applicant(uuid, uuid, uuid, int) to authenticated;
