Packet: M27-T6 Grants audit — exact function buckets + 07 §4 drift
Files changed: none (BLOCKED before edit)
Behavior implemented: none. Root cause verified live against lane-j's own Supabase (read-only pg_proc query, no db commands run): of the ruling's SERVICE_ONLY/PUBLIC_INVOKER_AUTHENTICATED names, 13 do not exist —
attendance_daily_counts, compute_mastery, emit_workflow_event, enqueue_due_forecasts,
enqueue_due_workflows, enqueue_insight_detection, enqueue_mastery_compute,
forecast_attendance_series, forecast_fee_series, mastery_heatmap, mastery_student_stats,
record_insights, workflow_metric (plus the 8 insight_src_* likely missing, not individually checked).
Present: jobs_claim, jobs_complete, submit_public_enquiry, record_online_payment,
ledger_totals, term_collection_totals, enqueue_due_reports.
Cause: M27 header claims "Prereqs merged: M12–M25, X01–X08, MOD" but this lane's `main`
(git log) and migrations (`supabase/migrations` stop at 0084/MOD) only carry M12, M15,
M18, MOD — M19 (insights), M20 (mastery), M21 (forecast), M23 (workflows), X04 (late
fee sweep) are not merged here. `src/modules/{mastery,insights,forecast,agents,workflows}`
do not exist in this tree.
Tests run: none — writing the exact literal buckets the ruling specifies would make
`pnpm test:security tests/security/grants.test.ts` fail permanently on missing functions,
not a fixable-in-T6-scope defect (migrations for those names belong to M19/M20/M21/M23/X04
tasks, outside T6's FILES).
Tests not run and why: see above — root cause is a missing-prereq gap, not a test-writing
problem; retrying doesn't change DB state.
Limitations / honesty label: n/a.
Security / integration risks: none introduced (no edit made).
Follow-ups: controller re-run M27-T6 after M19, M20, M21, M23, X04 are merged into this
lane (or re-point the lane at a `main` that has them). Until then grants.test.ts and 07 §4
stay as-is (M01–M18/MOD coverage only).
New dependencies (justification): none
Assumptions made: none — blocked on verified fact, not inferred.
