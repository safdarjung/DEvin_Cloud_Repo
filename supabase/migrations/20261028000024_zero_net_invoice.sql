-- T-0NN fix (Batch C): app.generate_invoice crashes ledger_entries' own
-- check constraint `(debit = 0) <> (credit = 0)` when a student's
-- concessions cover 100% of every fee head — net total 0, so the
-- `fees_receivable` row would be inserted as (debit 0, credit 0), which the
-- constraint (exactly one of debit/credit nonzero) rejects. This is the
-- reason finance.ts has shipped with a 99%-not-100% ews_rte shortcut
-- (0008's own header comment references it). Root cause: a net-zero
-- invoice has nothing receivable, so the receivable row should not be
-- written at all, not that 0/0 is a valid "balanced" row.
--
-- `create or replace` of 0008's app.generate_invoice (06 §W9) — signature
-- (uuid, uuid) returns uuid is unchanged, so no new 07 §4 definer row.
-- Every check/branch is identical to 0008 except:
--   1. the `fees_receivable` ledger_entries insert is skipped when the
--      invoice's net total is 0 (nothing owed, so no receivable to book —
--      fee_income/concession_expense still balance the books on their own:
--      concession_expense (debit = subtotal) = fee_income (credit = subtotal)).
--   2. a net-zero invoice is inserted as `status = 'paid'` (06 §W9/0008's own
--      app.record_payment uses the same `paid_total >= total` rule — with
--      total 0 and paid_total 0, that rule already says 'paid'), instead of
--      the default `issued`.
create or replace function app.generate_invoice(p_student_id uuid, p_term_id uuid)
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
  v_total numeric(12, 2);
  v_status text;
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
  -- FK is satisfied; totals (and the final status) are filled in by the
  -- UPDATE after the loop.
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

    -- Several concessions may target one head; cap their sum at the line
    -- amount so a line (and the invoice total) never goes negative.
    select least(coalesce(sum(
      case
        when c.percent is not null then round(v_line_amount * c.percent / 100, 2)
        else least(c.amount, v_line_amount)
      end
    ), 0), v_line_amount)
    into v_concession_amount
    from public.concessions c
    where c.fee_assignment_id = v_fee_assignment.id and c.head = v_component.head;

    insert into public.invoice_lines (institution_id, invoice_id, head, description, amount, concession_amount)
    values (v_institution_id, v_invoice_id, v_component.head, v_component.head || ' (' || v_component.frequency || ')', v_line_amount, v_concession_amount);

    v_subtotal := v_subtotal + v_line_amount;
    v_concession_total := v_concession_total + v_concession_amount;
  end loop;

  v_total := v_subtotal - v_concession_total;
  -- A fully concessioned invoice (net total 0) has nothing outstanding —
  -- same "paid_total >= total" rule app.record_payment uses, applied here
  -- with paid_total still at its 0 default.
  v_status := case when v_total <= 0 then 'paid' else 'issued' end;

  update public.invoices
  set subtotal = v_subtotal, concession_total = v_concession_total, total = v_total, status = v_status
  where id = v_invoice_id;

  -- Ledger (06 §W9): Dr fees_receivable (net) + Dr concession_expense
  -- (concession) = Cr fee_income (gross) — balances because
  -- total = subtotal - concession_total. When net total is 0 there is
  -- nothing receivable, so that row is skipped entirely rather than
  -- inserted as a degenerate (debit 0, credit 0) row — ledger_entries'
  -- own check constraint requires exactly one of debit/credit nonzero.
  if v_total <> 0 then
    insert into public.ledger_entries (institution_id, invoice_id, account, debit, credit, entry_date, memo)
    values (v_institution_id, v_invoice_id, 'fees_receivable', v_total, 0, v_today, 'invoice ' || v_invoice_no);
  end if;

  -- No billable component this term (subtotal 0): no income row either.
  if v_subtotal <> 0 then
    insert into public.ledger_entries (institution_id, invoice_id, account, debit, credit, entry_date, memo)
    values (v_institution_id, v_invoice_id, 'fee_income', 0, v_subtotal, v_today, 'invoice ' || v_invoice_no);
  end if;

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
    jsonb_build_object('invoice_no', v_invoice_no, 'subtotal', v_subtotal, 'concession_total', v_concession_total, 'total', v_total),
    jsonb_build_object('student_id', p_student_id, 'term_id', p_term_id)
  );

  return v_invoice_id;
end;
$$;
