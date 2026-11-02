Packet: T-0NN M11-T2 Migration 0073 — question_bank + exam_papers schedule columns
Files changed: supabase/migrations/20261028000073_question_bank_exam_schedule.sql (new); tests/db/question-bank-rls.test.ts (new); tests/security/rls-expectations.ts (added question_bank row)
Behavior implemented: question_bank table (class C, mcq options check, is_active archive, no delete) + RLS (owner/principal/exam_controller institution-wide, teacher scoped to taught grade+subject via my_taught_section_subjects join class_sections) + column grant (institution_id/created_by immutable). exam_papers: scheduled_at/duration_minutes/room_id + pair/room checks + partial index; exam_papers_insert/update rebound to initPlan form + room bound to institution.
Tests run: pnpm db:reset (ok) -> pnpm db:types (ok) -> pnpm test:db tests/db/question-bank-rls.test.ts (13/13 pass) -> pnpm test:security (1555/1556 pass; 1 pre-existing failure in tests/security/grants.test.ts, unrelated — 0076 student_lifecycle RPCs not yet in its expected list, not touched by this task) -> pnpm lint (clean) -> pnpm typecheck (clean)
Tests not run and why: full pnpm test:db (BRIEF-COMMON: non-owner-scope rule; ran only this task's own file plus full security suite as ACCEPT requires)
Limitations / honesty label: none (no UI in M11-T2)
Security / integration risks: CHECK constraint on mcq options needed `options is not null and ...` (not bare jsonb_typeof) — bare form let NULL pass the CHECK silently; fixed, verified by the "mcq without options -> 23514" test.
Follow-ups: none
New dependencies (justification): none
Assumptions made: created_by -> public.profiles(id) per ruling (not staff, unlike assignments); grants.test.ts's RPC-list gap is another milestone's (M10/0076) debt, left untouched (not my files per worktree rules).
