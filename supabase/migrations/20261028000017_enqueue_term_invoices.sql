-- T-031 phase 2 (follow-up recorded in the T-031 completion report): a
-- "generate invoices for all grades" run has no deadline-safe synchronous
-- path (up to ~3,024 students for a full school). This adds a bulk-enqueue
-- wrapper so the whole-school case goes through the job queue instead of
-- one unbounded server-action request; the single-grade sync path
-- (`runGenerateTermInvoices` / `public.generate_invoice` per student,
-- 20261028000008) is unchanged and still used when a specific grade is
-- picked.
--
-- Single `public.*` security-definer function (no `app.*` twin) — same
-- shape as `public.jobs_requeue` (20261028000012): there is no trusted
-- same-transaction internal caller that needs the unchecked version, so the
-- role check lives directly in the one exposed function. `app` is not
-- PostgREST-exposed (05 §5), so this must be `public.*` to be callable at
-- all; it only wraps `app.enqueue_job` (0003), never writes `public.jobs`
-- directly.
create function public.enqueue_term_invoices(p_institution_id uuid, p_term_id uuid, p_grade_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term public.terms;
  v_grade_ok boolean;
  v_payload jsonb;
  v_key text;
  v_job_id uuid;
begin
  if app.current_user_id() is null then
    raise exception 'code:unauthenticated' using detail = 'sign-in required';
  end if;

  -- finance.invoice.generate (07 §2.2) is owner/principal/accountant —
  -- admin is NOT in that row, same `app.finance_write_roles()` gate
  -- `public.generate_invoice` already uses (0008).
  if not app.has_role(p_institution_id, app.finance_write_roles()) then
    raise exception 'code:forbidden' using detail = 'caller does not hold a finance.invoice.generate role for this institution';
  end if;

  -- Prove the term belongs to the institution — never trust a
  -- caller-supplied id from another tenant.
  select * into v_term from public.terms where id = p_term_id and institution_id = p_institution_id;
  if v_term.id is null then
    raise exception 'code:not_found' using detail = 'term not found for this institution';
  end if;

  if p_grade_id is not null then
    select exists(select 1 from public.grades where id = p_grade_id and institution_id = p_institution_id) into v_grade_ok;
    if not v_grade_ok then
      raise exception 'code:not_found' using detail = 'grade not found for this institution';
    end if;
  end if;

  -- Payload built entirely from rows already proven to belong to this
  -- institution/term — never echoes a raw caller-supplied blob (07 §4
  -- lesson: a service-role job handler later runs this payload).
  v_payload := jsonb_build_object('term_id', p_term_id, 'grade_id', p_grade_id);
  v_key := 'invoices:' || p_term_id::text || ':' || coalesce(p_grade_id::text, 'all');

  v_job_id := app.enqueue_job(p_institution_id, 'finance.generate_term_invoices', v_payload, v_key);

  perform app.audit(
    p_institution_id,
    app.current_user_id(),
    'finance.invoice.generate_term.enqueued',
    'term',
    p_term_id,
    null,
    v_payload,
    jsonb_build_object('jobId', v_job_id, 'key', v_key)
  );

  return jsonb_build_object('jobId', v_job_id);
end;
$$;

revoke execute on function public.enqueue_term_invoices(uuid, uuid, uuid) from public, anon;
grant execute on function public.enqueue_term_invoices(uuid, uuid, uuid) to authenticated;
