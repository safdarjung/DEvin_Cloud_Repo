-- T-032 phase 2 (follow-up recorded in the T-032 completion report):
-- `receipts.snapshot` carried only ids (invoice_id, student_id) alongside
-- amount/mode/reference/received_at/heads — correct for the immutability
-- guarantee ("must not change if names change later") but left the
-- printed receipt with no human-readable identification at all. This adds
-- the display fields the receipt actually needs, captured at payment time
-- so they freeze with the rest of the snapshot.
--
-- `create or replace app.record_payment`: every existing check (amount >
-- 0, idempotent replay fast-path, outstanding-balance validation,
-- received_at not in the future, financial-year math, ledger entries,
-- invoice status transition, audit) is byte-for-byte unchanged from
-- 20261028000008 — diffed below; the only addition is the extra lookup
-- feeding the richer snapshot object. `public.record_payment` (the
-- role-checked PostgREST wrapper) is untouched — same signature, same
-- gate (`app.finance_write_roles()`), nothing here changes who can call
-- this or what they're checked against.
create or replace function app.record_payment(
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
  v_school_name text;
  v_student_name text;
  v_admission_no text;
  v_class_label text;
  v_term_name text;
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

  -- T-032 phase 2: snapshot display fields, captured now so the printed
  -- receipt never changes if the student is renamed or re-sectioned later.
  -- The student's enrolment is looked up for the invoice's own academic
  -- year (not "whatever is active today"), preferring an active row.
  select i.name, trim(s.first_name || ' ' || coalesce(s.last_name, '')), s.admission_no, t.name
  into v_school_name, v_student_name, v_admission_no, v_term_name
  from public.institutions i, public.students s, public.terms t
  where i.id = v_institution_id and s.id = v_invoice.student_id and t.id = v_invoice.term_id;

  select g.display_name || '-' || cs.name
  into v_class_label
  from public.enrolments e
  join public.class_sections cs on cs.id = e.class_section_id
  join public.grades g on g.id = cs.grade_id
  where e.student_id = v_invoice.student_id and e.academic_year_id = v_invoice.academic_year_id
  order by (e.status = 'active') desc, e.created_at desc
  limit 1;

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
      'receipt_no', v_receipt_no,
      'school_name', v_school_name,
      'student_name', v_student_name,
      'admission_no', v_admission_no,
      'class_label', v_class_label,
      'invoice_no', v_invoice.invoice_no,
      'term_name', v_term_name,
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

-- Grants unchanged from 0008 (create or replace keeps existing grants, but
-- restated here for auditability — same revoke/grant shape, same signature).
revoke execute on function app.record_payment(uuid, numeric, text, text, timestamptz, text) from public, anon, authenticated;
