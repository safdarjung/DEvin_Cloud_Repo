Packet: M16-T3 Migration 0078 — attendance_daily_counts
Files changed: supabase/migrations/20261028000078_dashboard_attendance_counts.sql (new); tests/db/attendance-daily-counts.test.ts (new); src/lib/db/types.ts (regen)
Behavior implemented: `public.attendance_daily_counts(p_institution_id, p_from, p_to, p_class_section_id?, p_student_id?, p_by_section?)` — security invoker, stable, search_path='', joins attendance_records/sessions, excludes period sessions, validates range ≤91 days, revoked from public/anon, granted to authenticated.
Tests run: `pnpm db:reset` ok (seed counts logged); `pnpm db:types` ok (regenerated, function present); `pnpm test:db tests/db/attendance-daily-counts.test.ts` → 8/8 pass; `pnpm test:security` → 19 files / 2191 tests pass (grants audit unaffected — function is invoker, not in the definer-filtered PUBLIC_AUTHENTICATED check); `pnpm lint` clean; `pnpm typecheck` clean.
Tests not run and why: none skipped.
Limitations / honesty label: n/a (DB function only, no UI).
Security / integration risks: none found; RLS alone scopes rows (no definer row needed in 07 §4).
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: date-range filter (`s.date between p_from and p_to`) applied in addition to the ruling's explicit joins/group-by, since the function takes `p_from`/`p_to` as its stated purpose.
