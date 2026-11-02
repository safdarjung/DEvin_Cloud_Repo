Packet: M13-T7 Calendar actions
Files changed: src/modules/calendar/actions.ts (new); tests/db/calendar-actions.test.ts (new);
src/app/api/v1/actions/all-actions.ts (+1 import line); tests/security/escalation.test.ts (+2 fixtures)
Behavior implemented: upsertCalendarEvent (calendar.event.upsert) and deleteCalendarEvent
(calendar.event.delete), permission academics.manage. Upsert mirrors upsertGrade style.
Error mapping per rulings: 23503→not_found, 42501→forbidden, trigger code:validation_failed
passes through mapSqlError, 0-row update/delete→not_found. Audits id/kind/startsOn/endsOn only.
Tests run: pnpm test:db tests/db/calendar-actions.test.ts → 6/6 pass.
pnpm test:security tests/security/escalation.test.ts → 851/852 pass (1 pre-existing failure,
not mine, see below). pnpm lint + typecheck on touched files → clean.
Tests not run: full test:db, db:reset, seed, db:types (per lane rules, not owner).
Limitations / honesty label: none (M13 sends no messages, no badge per rulings).
Security / integration risks: none found; RLS year-mismatch correctly surfaces as forbidden
(42501 mapped explicitly, matching this task's ruling, not timetable's older validation_failed
mapping).
Pre-existing failures NOT from my files (concurrent lanes, untouched by me):
- tests/unit/action-names-unique.test.ts: 2 fails — hardcoded `names` sets expect
  transport.*/facilities.* actions/queries not yet manifest-imported by other in-progress tasks.
- tests/security/escalation.test.ts: registry.size 85 vs countDefineActionCalls() 90 — same
  cause (transport actions exist in src but not yet in all-actions.ts).
- pnpm typecheck: pre-existing errors in src/modules/lifecycle/actions.ts,
  src/modules/people/actions.ts, src/modules/transport/queries.ts (other agents' files).
Follow-ups: none for T7 itself.
New dependencies (justification): none.
Assumptions made: "year from another institution → forbidden" (task's literal wording) taken
as the 42501 RLS-violation path per this task's ErrorCode-mapping ruling (42501→forbidden),
distinct from timetable's earlier choice to map the same case to validation_failed.
