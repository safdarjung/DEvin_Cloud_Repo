-- 0046 — service_role EXECUTE parity on public RPC wrappers (T-044).
--
-- Local Supabase default privileges grant EXECUTE on new public functions to
-- service_role; migrations revoke anon/authenticated explicitly but never
-- service_role, and the server's admin client (job handlers, public site)
-- relies on it. Newer hosted projects do not apply that default, so these
-- grants are written out. service_role already bypasses RLS; this adds no
-- capability beyond local. Idempotent: a no-op on local.

grant execute on function public.add_enquiry_note(p_institution_id uuid, p_enquiry_id uuid, p_text text) to service_role;
grant execute on function public.apply_recheck_decision(p_request_id uuid, p_decision text, p_new_marks numeric, p_note text) to service_role;
grant execute on function public.close_marks_entry(p_institution_id uuid, p_exam_id uuid) to service_role;
grant execute on function public.convert_enquiry(p_institution_id uuid, p_enquiry_id uuid, p_applicant jsonb, p_guardian jsonb, p_grade_id uuid, p_academic_year_id uuid) to service_role;
grant execute on function public.correct_attendance(p_institution_id uuid, p_record_id uuid, p_new_status text, p_reason text) to service_role;
grant execute on function public.decide_application(p_institution_id uuid, p_application_id uuid, p_decision text, p_note text) to service_role;
grant execute on function public.enqueue_term_invoices(p_institution_id uuid, p_term_id uuid, p_grade_id uuid) to service_role;
grant execute on function public.enrol_applicant(p_application_id uuid, p_class_section_id uuid, p_fee_structure_id uuid, p_roll_no integer) to service_role;
grant execute on function public.enter_marks(p_institution_id uuid, p_paper_id uuid, p_rows jsonb) to service_role;
grant execute on function public.exam_verification(p_institution_id uuid, p_exam_id uuid) to service_role;
grant execute on function public.get_public_site(p_slug text) to service_role;
grant execute on function public.jobs_requeue(p_institution_id uuid, p_id uuid) to service_role;
grant execute on function public.open_marks_entry(p_institution_id uuid, p_exam_id uuid) to service_role;
grant execute on function public.publish_exam_results(p_exam_id uuid) to service_role;
grant execute on function public.publish_page(p_page_id uuid, p_version_id uuid) to service_role;
grant execute on function public.record_audit_event(p_institution_id uuid, p_action text, p_entity_type text, p_entity_id uuid, p_before jsonb, p_after jsonb, p_metadata jsonb) to service_role;
grant execute on function public.record_payment(p_invoice_id uuid, p_amount numeric, p_mode text, p_reference text, p_received_at timestamp with time zone, p_idempotency_key text) to service_role;
grant execute on function public.reopen_marks_entry(p_institution_id uuid, p_exam_id uuid) to service_role;
grant execute on function public.request_recheck(p_institution_id uuid, p_result_id uuid, p_exam_paper_id uuid, p_reason text) to service_role;
grant execute on function public.start_recheck_review(p_institution_id uuid, p_request_id uuid) to service_role;
grant execute on function public.submit_attendance(p_institution_id uuid, p_session_id uuid) to service_role;

alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
