-- 0045 — explicit Data API grants (T-044 hosted deploy).
--
-- Local Supabase grants anon/authenticated/service_role table privileges on
-- new public tables through default privileges; migrations 0001–0044 relied
-- on that. Newer hosted projects do not auto-grant (only TRUNCATE/REFERENCES/
-- TRIGGER), so on hosted every PostgREST read/write failed with "permission
-- denied" and the seed's API writes failed silently.
--
-- These statements reproduce exactly the effective grants of a local
-- `supabase db reset` through 0044 (generated from pg_class/pg_attribute
-- ACLs), so RLS stays the row-level control and every deliberate revoke is
-- kept: profiles has no table-level UPDATE for authenticated, only the
-- column grant below (T-042 MED-1). Idempotent: a no-op on local.
-- Function EXECUTE grants are already explicit in their own migrations.

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.academic_years to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.academic_years to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.academic_years to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_usage_events to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_usage_events to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_usage_events to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.answer_sheets to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.answer_sheets to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.answer_sheets to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.application_decisions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.application_decisions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.application_decisions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applications to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applications to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.applications to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_answer_keys to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_answer_keys to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_answer_keys to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_submissions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_submissions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignment_submissions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignments to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.assignments to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.attendance_corrections to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.attendance_corrections to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.attendance_corrections to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.attendance_records to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.attendance_records to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.attendance_records to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.attendance_sessions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.attendance_sessions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.attendance_sessions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.audit_events to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.audit_events to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.audit_events to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.campuses to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.campuses to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.campuses to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.class_sections to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.class_sections to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.class_sections to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.concessions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.concessions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.concessions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.curriculum_units to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.curriculum_units to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.curriculum_units to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.delivery_attempts to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.delivery_attempts to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.delivery_attempts to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.departments to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.departments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.departments to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.enquiries to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.enquiries to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.enquiries to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.enrolment_status_history to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.enrolment_status_history to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.enrolment_status_history to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.enrolments to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.enrolments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.enrolments to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.events to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.events to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.events to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.exam_papers to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.exam_papers to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.exam_papers to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.exams to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.exams to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.exams to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.fee_assignments to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.fee_assignments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.fee_assignments to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.fee_components to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.fee_components to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.fee_components to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.fee_structures to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.fee_structures to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.fee_structures to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.grades to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.grades to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.grades to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.guardian_students to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.guardian_students to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.guardian_students to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.guardians to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.guardians to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.guardians to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.institution_sequences to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.institution_sequences to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.institution_sequences to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.institutions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.institutions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.institutions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoice_lines to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoice_lines to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoice_lines to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoices to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoices to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoices to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.jobs to anon;
grant delete, insert, maintain, references, select, trigger, truncate on table public.jobs to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.jobs to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ledger_entries to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ledger_entries to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ledger_entries to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.marks to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.marks to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.marks to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.memberships to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.memberships to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.memberships to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notices to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notices to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notices to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notifications to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notifications to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notifications to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.page_versions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.page_versions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.page_versions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.pages to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.pages to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.pages to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payments to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payments to service_role;
grant delete, insert, maintain, references, select, trigger, truncate on table public.profiles to anon;
grant delete, insert, maintain, references, select, trigger, truncate on table public.profiles to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.profiles to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.receipts to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.receipts to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.receipts to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.recheck_decisions to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.recheck_decisions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.recheck_decisions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.recheck_requests to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.recheck_requests to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.recheck_requests to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.results to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.results to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.results to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.staff to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.staff to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.staff to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.students to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.students to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.students to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.subject_assignments to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.subject_assignments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.subject_assignments to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.subjects to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.subjects to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.subjects to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.terms to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.terms to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.terms to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.websites to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.websites to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.websites to service_role;
grant update (avatar_path, full_name, phone) on table public.profiles to authenticated;

-- Keep future tables consistent with local: same default privileges for
-- objects created by postgres in public.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
