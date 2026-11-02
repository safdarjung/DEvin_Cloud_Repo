Packet: M17-T5 Email acceptance over HTTP (invite + announcement fan-out + listDeliveryLog)
Files changed: tests/db/email-channel-acceptance.test.ts (new, only file)
Behavior implemented: HTTP acceptance test, 2 cases. Keyed: invite over
/api/v1/actions/core.member.invite -> sent (1 Resend call); school-wide
announcement created+published over HTTP, runOnceCore fans out -> real-domain
guardian attempt sent/resend/re_1, reserved-domain guardian attempt simulated;
notifications.listDeliveryLog shows both statuses; job rerun makes 0 extra
Resend calls. Unkeyed: same flow, both deliveries simulated, 0 Resend calls.
Second guardian = own auth user + guardians/memberships row (fixture has 1
guardian/role); cleaned up in finally alongside inst.cleanup().
Tests run: pnpm test:db tests/db/email-channel-acceptance.test.ts -> 2 passed (2).
Tests not run: db:reset, demo:reset, db:types, full test:db, test:security (not owned).
Limitations / honesty label: n/a, no UI touched.
Security / integration risks: none new; reuses T1-T3 adapter/selector,
no new permission/RLS/definer surface.
Follow-ups: none beyond M17-T6 debt list (already covers webhook/retry/batch/invite-log debt).
New dependencies: none.
Assumptions made: audience type "school" (not role-scoped) for the acceptance
flow, per rulings' "school-wide announcement"; lint/typecheck errors seen in
pnpm lint/typecheck are pre-existing in other packets' files (src/modules/people/leave.actions.ts,
src/modules/timetable/substitution.actions.ts, tests/db/period-attendance-actions.test.ts,
src/modules/people/hr.queries.ts warning) — untouched by this task, not caused by it.
