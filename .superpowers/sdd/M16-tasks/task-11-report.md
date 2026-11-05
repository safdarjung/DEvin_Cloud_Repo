Packet: M16-T11 `/today` swap — real timetable
Files changed: src/app/(tenant)/[institution]/today/page.tsx; e2e/j06-attendance.spec.ts
Behavior implemented: `timetableTodayFor(ctx)` joins `allSettled` gated on `isModuleEnabled(ctx,"timetable")`; rejection renders via `settled()` ErrorState. Deleted `demoTimetable` block + papers/sections entries mapping + `demoTimetable` import. Timetable widget renders unconditionally (no `demo &&` gate) via new `timetableWidget` (`settled(timetableR, ...)`), replacing the old `{timetable && <TimetableWidget.../>}`.
Tests run: `pnpm test:e2e e2e/j06-attendance.spec.ts` (own dev server, PORT=3105, DEMO_AUTO_LOGIN=false — proxy.ts auto-logs-in as principal on plain `/login` otherwise, same issue T10 flagged) → 3/4 pass. New test passes. 1 pre-existing failure ("teacher.viii-b cannot open VI-A's register directly", expects 404 gets 200) — confirmed pre-existing by running unmodified HEAD copy of the file, same result; not touched by me, not T11 scope. `pnpm exec eslint` + `tsc --noEmit` on both files → clean.
Tests not run and why: full lint/typecheck/test:e2e — lane rule, own files only.
Limitations / honesty label: none; no badge change.
Security / integration risks: none new; reuses existing RLS-scoped `timetableTodayFor` (T6), no new SQL.
Follow-ups: pre-existing j06 404-check failure (seed/RLS, not this packet) — flag for attendance-register owner, same file T10/T12/T14 share.
New dependencies (justification): none.
Assumptions made: ran my own dev server (PORT=3105, DEMO_AUTO_LOGIN=false) for the e2e run per T10's precedent; stopped by exact PID afterward; Supabase stack untouched.
