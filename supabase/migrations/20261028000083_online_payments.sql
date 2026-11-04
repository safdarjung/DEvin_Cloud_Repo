-- M12-T5 (online_payments): payment intents for the Razorpay test-mode
-- checkout — 06 ruling set "Online payments", "RLS" (M12-tasks.md).
-- Modules are packaging, not a security boundary (owner directive
-- 2026-11-02): this migration enforces permissions + RLS + definer role
-- checks exactly as if no module existed; `online_payments` module gating
-- lives in the TS action layer (T11), never here.

-- ---------------------------------------------------------------------------
-- online_payment_intents. State machine created -> paid | unreconciled, driven only by
-- public.record_online_payment (service_role). No block_mutation trigger:
-- unlike payment_reversals/fee_reminders this row IS updated in place
-- (created -> paid) by that definer, which would itself be blocked by
-- block_mutation (it has no app.allow_reset bypass reason to use here).
-- ---------------------------------------------------------------------------

create table public.online_payment_intents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id),
  invoice_id uuid not null references public.invoices (id),
  amount numeric(12, 2) not null check (amount >= 1.00),
  currency text not null default 'INR' check (currency = 'INR'),
  provider text not null check (provider in ('razorpay', 'simulated')),
  provider_order_id text not null unique,
  provider_payment_id text unique,
  status text not null default 'created' check (status in ('created', 'paid', 'unreconciled')),
  payment_id uuid unique references public.payments (id),
  created_by uuid references public.profiles (id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, idempotency_key),
  -- `paid` iff both payment_id and provider_payment_id are set (06 ruling);
  -- `unreconciled` = captured at the gateway but not bookable (invoice paid
  -- or closed since the intent): provider_payment_id set, payment_id null.
  constraint online_payment_intents_paid_consistency check (
    (status = 'paid' and payment_id is not null and provider_payment_id is not null)
    or (status = 'unreconciled' and payment_id is null and provider_payment_id is not null)
    or (status = 'created' and payment_id is null and provider_payment_id is null)
  )
);

create index online_payment_intents_institution_id_idx on public.online_payment_intents (institution_id);
create index online_payment_intents_invoice_id_idx on public.online_payment_intents (invoice_id);

create trigger set_updated_at
before update on public.online_payment_intents
for each row execute function app.set_updated_at();

alter table public.online_payment_intents enable row level security;

-- SELECT only (no insert/update/delete policy — definer-only writes, lesson
-- 3; both definers run as the table owner and so are unaffected by RLS).
-- Mirrors payment_reversals_select (0074) / receipts_select (0020):
-- finance_roles() full read, plus the invoice's own guardian/student scope.
create policy online_payment_intents_select on public.online_payment_intents
  for select to authenticated
  using (
    institution_id = any((select app.my_institution_ids(app.finance_roles())))
    or exists (
      select 1 from public.invoices i
      where i.id = online_payment_intents.invoice_id
        and i.institution_id = online_payment_intents.institution_id
        and i.student_id = any((select app.my_student_ids()))
    )
  );

-- ---------------------------------------------------------------------------
-- public.create_payment_intent(...) — single public.* definer (same shape
-- as public.enqueue_fee_reminders, 0074): no trusted internal caller needs
-- an unchecked app.* twin, role/scope check directly here. Authorization is
-- narrower than app.my_student_ids() (07 §2.2 finance.payment.online has no
-- bare "student" holder): a guardian of the invoice's student, not the
-- student themself, same as finance_write_roles() for staff. A caller who
-- fails both checks gets not_found (never reveal that the invoice exists),
-- same reasoning as 0074's void_payment wrapper.
-- ---------------------------------------------------------------------------

create function public.create_payment_intent(
  p_invoice_id uuid,
  p_amount numeric,
  p_provider text,
  p_provider_order_id text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_institution_id uuid;
  v_existing_id uuid;
  v_existing_invoice_id uuid;
  v_outstanding numeric(12, 2);
  v_intent_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice.id is null then
    raise exception 'code:not_found' using detail = 'invoice not found';
  end if;

  v_institution_id := v_invoice.institution_id;

  if not (
    app.has_role(v_institution_id, app.finance_write_roles())
    or exists (
      select 1 from public.guardian_students gs
      join public.memberships m
        on m.guardian_id = gs.guardian_id
       and m.institution_id = gs.institution_id
      where m.user_id = app.current_user_id()
        and m.status = 'active'
        and gs.institution_id = v_institution_id
        and gs.student_id = v_invoice.student_id
    )
  ) then
    raise exception 'code:not_found' using detail = 'invoice not found';
  end if;

  -- Idempotent fast path: a replay of an already-created intent returns the
  -- same id without re-validating invoice state (06 ruling). The key must
  -- belong to THIS invoice: reused for another invoice -> conflict.
  select id, invoice_id into v_existing_id, v_existing_invoice_id
  from public.online_payment_intents
  where institution_id = v_institution_id and idempotency_key = p_idempotency_key;

  if v_existing_id is not null and v_existing_invoice_id <> p_invoice_id then
    raise exception 'code:conflict' using detail = 'idempotency key already used for another invoice';
  end if;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  if v_invoice.status not in ('issued', 'part_paid') then
    raise exception 'code:invalid_state' using detail = 'invoice is not open for payment';
  end if;

  v_outstanding := v_invoice.total - v_invoice.paid_total;
  if p_amount is null or p_amount < 1.00 or p_amount > v_outstanding then
    raise exception 'code:validation_failed' using detail = 'amount must be between 1.00 and the invoice outstanding balance';
  end if;

  if p_provider not in ('razorpay', 'simulated') then
    raise exception 'code:validation_failed' using detail = 'invalid provider';
  end if;

  if p_provider = 'razorpay' and p_provider_order_id !~ '^order_[A-Za-z0-9]{6,40}$' then
    raise exception 'code:validation_failed' using detail = 'invalid razorpay order id';
  end if;

  if p_provider = 'simulated' and p_provider_order_id !~ '^sim_order_[a-f0-9]{32}$' then
    raise exception 'code:validation_failed' using detail = 'invalid simulated order id';
  end if;

  insert into public.online_payment_intents (institution_id, invoice_id, amount, provider, provider_order_id, created_by, idempotency_key)
  values (v_institution_id, p_invoice_id, p_amount, p_provider, p_provider_order_id, app.current_user_id(), p_idempotency_key)
  on conflict (institution_id, idempotency_key) do nothing
  returning id into v_intent_id;

  if v_intent_id is null then
    -- Lost the race to a concurrent call with the same key: return the winner's id.
    select id, invoice_id into v_intent_id, v_existing_invoice_id from public.online_payment_intents
    where institution_id = v_institution_id and idempotency_key = p_idempotency_key;
    if v_existing_invoice_id <> p_invoice_id then
      raise exception 'code:conflict' using detail = 'idempotency key already used for another invoice';
    end if;
    return v_intent_id;
  end if;

  perform app.audit(
    v_institution_id,
    app.current_user_id(),
    'finance.payment.intent_created',
    'online_payment_intent',
    v_intent_id,
    null,
    null,
    jsonb_build_object('amount', p_amount, 'provider', p_provider)
  );

  return v_intent_id;
end;
$$;

revoke execute on function public.create_payment_intent(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.create_payment_intent(uuid, numeric, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.record_online_payment(...) — service_role only (same grant shape
-- as 0007's public.submit_public_enquiry): the only caller is T12's webhook
-- route, running after its own HMAC signature verification. Locks the
-- intent row, then delegates the actual money-movement to app.record_payment
-- (0008) — that function's own outstanding check and
-- `finance.payment.recorded` audit apply (actor null = system, since this
-- caller has no auth.uid()).
--
-- Money captured at the gateway is never dropped (M12 security review,
-- HIGH): if the invoice was paid or closed between intent and capture
-- (`code:invalid_state` / `code:validation_failed`), the intent becomes
-- `unreconciled` (provider payment id kept, no payment/ledger row), audit
-- `finance.payment.unreconciled`, and the webhook answers 200 so Razorpay
-- stops retrying. Manual refund/reallocation is DBT debt (12 §3).
-- ---------------------------------------------------------------------------

create function public.record_online_payment(
  p_order_id text,
  p_provider_payment_id text,
  p_amount_paise bigint,
  p_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.online_payment_intents;
  v_mode text;
  v_payment_result jsonb;
  v_receipt_id uuid;
  v_receipt_no text;
  v_payment_id uuid;
  v_invoice_status text;
  v_reason text;
begin
  select * into v_intent from public.online_payment_intents where provider_order_id = p_order_id for update;
  if v_intent.id is null then
    raise exception 'code:not_found' using detail = 'payment intent not found';
  end if;

  if v_intent.status = 'unreconciled' then
    if v_intent.provider_payment_id = p_provider_payment_id then
      return jsonb_build_object(
        'payment_id', null, 'receipt_id', null, 'receipt_no', null,
        'duplicate', true, 'unreconciled', true
      );
    end if;
    raise exception 'code:conflict' using detail = 'intent already captured with a different payment';
  end if;

  if v_intent.status = 'paid' then
    if v_intent.provider_payment_id = p_provider_payment_id then
      select r.id, r.receipt_no into v_receipt_id, v_receipt_no
      from public.receipts r where r.payment_id = v_intent.payment_id;
      return jsonb_build_object(
        'payment_id', v_intent.payment_id, 'receipt_id', v_receipt_id,
        'receipt_no', v_receipt_no, 'duplicate', true
      );
    else
      raise exception 'code:conflict' using detail = 'intent already paid with a different payment';
    end if;
  end if;

  if p_amount_paise is null or p_amount_paise <> round(v_intent.amount * 100)::bigint then
    raise exception 'code:validation_failed' using detail = 'paise amount does not match the intent';
  end if;

  v_mode := case p_method when 'upi' then 'upi' when 'card' then 'card' else 'neft' end;

  begin
    -- app.record_payment has no status check (a cancelled invoice would
    -- still book): lock the invoice here first (same intent -> invoice order).
    select status into v_invoice_status from public.invoices where id = v_intent.invoice_id for update;
    if v_invoice_status not in ('issued', 'part_paid') then
      raise exception 'code:invalid_state' using detail = 'invoice is not open for payment';
    end if;

    v_payment_result := app.record_payment(
      v_intent.invoice_id, v_intent.amount, v_mode,
      'razorpay ' || p_provider_payment_id, now(), 'razorpay:' || p_provider_payment_id
    );
  exception when raise_exception then
    if sqlerrm not in ('code:invalid_state', 'code:validation_failed') then
      raise;
    end if;
    v_reason := substr(sqlerrm, 6);

    update public.online_payment_intents
    set status = 'unreconciled', provider_payment_id = p_provider_payment_id
    where id = v_intent.id;

    -- No PII: ids, amount and the reason code only.
    perform app.audit(
      v_intent.institution_id,
      null,
      'finance.payment.unreconciled',
      'online_payment_intent',
      v_intent.id,
      null,
      null,
      jsonb_build_object(
        'order_id', p_order_id, 'provider_payment_id', p_provider_payment_id,
        'amount', v_intent.amount, 'reason', v_reason
      )
    );

    return jsonb_build_object(
      'payment_id', null, 'receipt_id', null, 'receipt_no', null,
      'duplicate', false, 'unreconciled', true
    );
  end;

  v_payment_id := (v_payment_result ->> 'payment_id')::uuid;

  update public.online_payment_intents
  set status = 'paid', provider_payment_id = p_provider_payment_id, payment_id = v_payment_id
  where id = v_intent.id;

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'receipt_id', (v_payment_result ->> 'receipt_id')::uuid,
    'receipt_no', v_payment_result ->> 'receipt_no',
    'duplicate', false
  );
end;
$$;

revoke execute on function public.record_online_payment(text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.record_online_payment(text, text, bigint, text) to service_role;
