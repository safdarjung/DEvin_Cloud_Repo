Packet: M08-T2 Migration 0070 part 1 — my_staff_ids, staff_attendance, leave_requests + guard, staff_check_in, decide_leave + RLS test
Files changed: supabase/migrations/20261028000070_staffing.sql (new); tests/db/staff-leave-rls.test.ts (new); src/lib/db/types.ts (regen, raw); tests/security/rls-expectations.ts (+2 entries); tests/security/grants.test.ts (+3 allowlist entries: app.my_staff_ids, public.decide_leave, public.staff_check_in)
Behavior implemented: app.my_staff_ids helper (mirrors my_class_teacher_section_ids); staff_attendance + leave_requests tables with RLS; app.guard_leave_requests state-machine trigger (forces pending/created_by on insert, overlap->conflict, GUC-gated decisions, immutable identity cols); public.staff_check_in (self mark present, on-leave->invalid_state, idempotent upsert); public.decide_leave (pending->approved/rejected never own, pending/approved->cancelled, audits {status} only, never reason/note).
Tests run: pnpm test:db tests/db/staff-leave-rls.test.ts -> 14/14 pass; pnpm test:security -> 18 files/1504 pass (updated grants.test.ts + rls-expectations.ts allowlists, needed); pnpm lint -> clean; pnpm typecheck -> clean; pnpm db:reset + db:types + seed -> clean, full seed ok.
Tests not run and why: tests/db/substitutions-rls.test.ts, period-attendance-rls.test.ts (T3/T4, not built yet).
Limitations / honesty label: no UI this milestone (per rulings); none needed here.
Security / integration risks: none found; app.* core RPCs revoked from everyone, public.* wrappers granted authenticated only; search_path='' pinned on all new functions.
Follow-ups: none new; T3 appends substitutions, T4 appends period attendance to same file.
New dependencies (justification): none
Assumptions made: decide_leave's p_decision values are exactly 'approved'|'rejected'|'cancelled' (matching leave_requests.status enum), not inferred from any other naming in the packet.
