-- T-042 fix round 2 (review LOW, lesson 5): the `public.generate_invoice`
-- wrapper (0008) skipped its finance.invoice.generate role check whenever
-- `app.current_user_id()` was null, treating any uid-less caller as trusted.
-- Only the service_role JWT (the T-031 job handler via the admin client) may
-- skip it now; any other caller without a uid gets `code:unauthenticated`.
-- Same signature, security definer, search_path and grants; the signed-in
-- branch is unchanged.

create or replace function public.generate_invoice(p_student_id uuid, p_term_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_institution_id uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    if app.current_user_id() is null then
      raise exception 'code:unauthenticated' using detail = 'sign-in required';
    end if;

    select institution_id into v_institution_id from public.students where id = p_student_id;
    -- finance.invoice.generate (07 §2.2) is owner/principal/accountant —
    -- admin is NOT in that row, unlike app.finance_roles() used for RLS reads.
    if v_institution_id is null or not app.has_role(v_institution_id, app.finance_write_roles()) then
      raise exception 'code:forbidden' using detail = 'caller does not hold a finance.invoice.generate role for this student''s institution';
    end if;
  end if;

  return app.generate_invoice(p_student_id, p_term_id);
end;
$$;
