-- 20261028000110 — bulk fee reminders for a chosen set of invoices
-- (dashboard redesign: bulk actions on invoices and defaulters). Same shape
-- as public.enqueue_fee_reminders (0074): security definer, role check here,
-- every id re-proven against this institution before the job is enqueued.
-- The job reuses the `finance.fee_reminder` handler with an `invoice_ids`
-- payload instead of `term_id`; the handler re-reads each invoice fresh.
-- No table changes.

create function public.enqueue_invoice_reminders(p_institution_id uuid, p_invoice_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_found int;
  v_timezone text;
  v_as_of date;
  v_payload jsonb;
  v_key text;
  v_job_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  if not app.has_role(p_institution_id, app.finance_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold a finance.reminder.send role for this institution';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}') into v_ids from unnest(p_invoice_ids) as x;
  if cardinality(v_ids) = 0 or cardinality(v_ids) > 200 then
    raise exception 'code:validation_failed' using detail = 'choose between 1 and 200 invoices';
  end if;

  select count(*) into v_found
  from public.invoices i
  where i.institution_id = p_institution_id and i.id = any(v_ids);
  if v_found <> cardinality(v_ids) then
    raise exception 'code:not_found' using detail = 'one or more invoices not found for this institution';
  end if;

  select coalesce(i.settings -> 'locale' ->> 'timezone', 'Asia/Kolkata') into v_timezone
  from public.institutions i where i.id = p_institution_id;
  v_as_of := (now() at time zone v_timezone)::date;

  v_payload := jsonb_build_object('invoice_ids', to_jsonb(v_ids), 'as_of', v_as_of);
  v_key := 'invoice_reminders:' || md5(array_to_string(v_ids, ',')) || ':' || v_as_of::text;

  v_job_id := app.enqueue_job(p_institution_id, 'finance.fee_reminder', v_payload, v_key);

  perform app.audit(
    p_institution_id,
    app.current_user_id(),
    'finance.reminders.enqueued',
    'invoice',
    null,
    null,
    jsonb_build_object('invoiceCount', cardinality(v_ids), 'as_of', v_as_of),
    jsonb_build_object('jobId', v_job_id, 'key', v_key)
  );

  return jsonb_build_object('jobId', v_job_id, 'invoiceCount', cardinality(v_ids));
end;
$$;

revoke execute on function public.enqueue_invoice_reminders(uuid, uuid[]) from public, anon;
grant execute on function public.enqueue_invoice_reminders(uuid, uuid[]) to authenticated;
