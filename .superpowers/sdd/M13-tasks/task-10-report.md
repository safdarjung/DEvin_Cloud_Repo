Packet: T-10 M13-T10 Calendar query
Files changed: src/modules/calendar/queries.ts (new), src/modules/calendar/query-defs.ts (new), tests/db/calendar-queries.test.ts (new), src/app/api/v1/query/all-queries.ts (+import), tests/db/api-query-route.test.ts (+smoke sample)
Behavior implemented: calendarForRole(ctx, {from?,to?,kinds?}) -> CalendarEventRow[] over academic_calendar_events, default window today..+90d in institution tz, overlap filter, kinds filter, ordered by startsOn. Exposed as calendar.forRole query (permission academics.read); RLS (0075) narrows guardian/student to audience=all.
Lane B note: no `module` field — MOD not merged in this worktree (T2's own ruling); defineQuery has no such param, so none declared, same as T2's migration.
Tests run: pnpm test:db tests/db/calendar-queries.test.ts tests/db/api-query-route.test.ts -> 2 files, 11 passed. pnpm lint (touched files) -> clean. pnpm typecheck -> no errors in touched files (pre-existing errors in lifecycle/actions.ts, people/actions.ts, transport/queries.ts — not my files, untouched).
Tests not run and why: full test:db / db:reset / seed / db:types — forbidden for non-DB-owner.
Limitations / honesty label: none (read-only, no simulated/limited channel).
Security / integration risks: none beyond RLS already shipped in 0075; query adds no new write path.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: default window inclusive of today; "overlapping" = starts_on <= to AND ends_on >= from (matches T2's holiday-block overlap semantics).
