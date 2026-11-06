Packet: X01-T12 Seed section `homeroom`
Files changed:
- scripts/seed/sections/homeroom.ts (new)
- scripts/seed/index.ts (registered last)
- tests/db/seed-homeroom.test.ts (new)

Behavior implemented: student_leave_requests (pending Aarav d1, rejected Ishaan decided by teacher.viii-b, approved non-named VI-A student June 2026 — service-role insert, no premark call, no attendance touched); diary_entries (VI-A/VIII-B/X-A, prevSchoolDay+d0 x 2 subject homework, d0 PTM general note, 15 rows); diary_acknowledgements (guardian.two acks Ishaan's note; Aarav's stays unacked).

Tests run: `DEMO_RESET_ALLOWED=true pnpm demo:reset` clean. `pnpm test:db tests/db/seed-homeroom.test.ts` 7/7 passed (incl. reseed-id-determinism). `pnpm test:db tests/db/seed-determinism.test.ts tests/db/seed-attendance.test.ts` 11/11 passed. `pnpm lint` clean. `pnpm typecheck` clean.

Tests not run and why: none blocked.

Limitations / honesty label: none; no UI, no badge.

Security / integration risks: none — service-role seed inserts only, no new RLS/SQL surface.

Follow-ups: none (T13 docs next).

New dependencies: none.

Assumptions made: approved leave's created_by = principal (mirrors staffing.ts leave rows, which all use principalId regardless of who'd realistically file it — "office entry on parent's behalf" is explicitly a skipped feature, so this is just a valid FK, not that feature). decided_by picks: teacher.vi-a for the approved VI-A leave (not stated in ruling). Homework body text is generic ("<Subject> homework: complete the exercises assigned in class."), not specified by ruling.
