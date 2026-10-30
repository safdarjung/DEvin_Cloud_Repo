-- T-042 grants audit (scripts/audit-grants.sql, tests/security/grants.test.ts):
-- 0003 granted `app.enqueue_job` to `authenticated` — a generic user-callable
-- enqueue whose payload the service-role job runner later executes (lesson 3).
-- `app` is not PostgREST-exposed, so it was not reachable over the API, but
-- every real caller is a security definer function running as its owner
-- (submit_attendance, enqueue_term_invoices, publish_exam_results,
-- apply_recheck_decision, enter_marks, record_payment, submit_public_enquiry,
-- ...), none of which needs the caller's own grant. Revoke it.

revoke execute on function app.enqueue_job(uuid, text, jsonb, text) from authenticated;
