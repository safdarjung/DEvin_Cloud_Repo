Packet: M15-T4 Migration 0077 part 2 — report documents + source functions
Files changed:
  supabase/migrations/20261028000077_scheduled_reports.sql (appended part 2)
  tests/db/report-sources-rls.test.ts (new)
  src/lib/db/types.ts (regen, additions only)
  tests/security/grants.test.ts (+1 line: app.my_report_ids, new RLS helper)
Behavior implemented: documents entity_type +'report', mime +'text/csv', bucket
  allowed_mime_types +text/csv; app.my_report_ids() (RLS perf helper);
  documents_select_report (permissive) + documents_report_guard (restrictive
  FOR ALL) — only service role writes report docs, only recipient roles read
  them; public.report_attendance_daily and public.report_fee_defaulters
  (security invoker SQL fns), both revoked from public/anon, granted
  authenticated+service_role.
Tests run:
  pnpm test:db tests/db/report-sources-rls.test.ts tests/db/documents-rls.test.ts
    -> 2 files, 17 passed
  pnpm test:security -> 19 files, 2200 passed
  pnpm lint -> clean; pnpm typecheck -> clean
Tests not run and why: none skipped; full pnpm test (unit) not run — out of
  packet scope, other lanes' files in flight (T1/T2/T6 artifacts present but
  untouched by me).
Limitations / honesty label: n/a (no UI, no simulated/limited surface).
Security / integration risks: documents_report_guard is restrictive FOR ALL;
  verified it doesn't narrow existing student/staff/application/submission
  read paths (documents-rls.test.ts still green) and blocks any authenticated
  write to a 'report' row (42501, tested).
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: grade/section ordered by their text values (display_name,
  name), not grades.sort_key — ruling said "order grade, section" referring
  to the output columns. tests/security/grants.test.ts required one line
  (my_report_ids is a legitimate new RLS helper, same shape as the existing
  my_*_ids entries) — fixed per CLAUDE.md "fix implementation... unless tests
  are wrong" (the allowlist was stale against my own addition, not a shared
  conflict).
