Packet: T-013 M08-T13 Seed section `staffing` (staff attendance, leave, substitution)
Files changed: scripts/seed/sections/staffing.ts (new), scripts/seed/index.ts (register after timetable), tests/db/seed-staffing.test.ts (new)
Behavior implemented: d0 = today (Asia/Kolkata) if Mon-Sat else next Monday. staff_attendance for last 5 school days through d0 (92/4/4 present/late/absent, PRNG, skips approved leave). leave_requests: approved sick (A, d0..d0+1), approved earned (B, d0+7..d0+9), 3 pending casual (C-E, created 2-60h ago), 1 rejected (F) — service role, created_by/decided_by = principal. substitutions: one assigned row covering A's first published slot on d0's weekday, substitute = first free teacher (not busy that weekday/period, not on approved leave), leave_request_id = A's leave.
Tests run: pnpm demo:reset (DEMO_RESET_ALLOWED=true) -> clean; pnpm test:db tests/db/seed-staffing.test.ts -> 5/5 pass; tests/db/seed-determinism.test.ts -> 1/1 pass; tests/db/seed-timetable.test.ts -> 5/5 pass; pnpm lint -> clean; pnpm typecheck -> clean.
Tests not run and why: none skipped — all packet ACCEPT commands ran.
Limitations / honesty label: no UI this milestone (per rulings); none added.
Security / integration risks: none — seed-only, service-role inserts bypass guard triggers by design (lesson 5), same pattern as 0070's other RPCs.
Follow-ups: none new; seed-determinism.test.ts not extended with a 3-table fingerprint (it doesn't generically enumerate tables — per-domain fingerprint fns only); own reseed-identical-ids check lives in seed-staffing.test.ts instead.
New dependencies (justification): none
Assumptions made: "every active staff" for staff_attendance = staff.status='active' (all seeded staff, teaching + non-teaching), not just teacherStaffIds. Teachers A-F = ctx.teacherStaffIds[0..5] (positional, deterministic, no identity significance).
