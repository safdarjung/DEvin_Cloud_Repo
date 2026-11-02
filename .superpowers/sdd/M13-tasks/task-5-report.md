Packet: M13-T5 Facilities actions
Files changed: src/modules/facilities/actions.ts (new); tests/db/facilities-actions.test.ts (new); src/app/api/v1/actions/all-actions.ts (append import); tests/security/escalation.test.ts (append 4 C-03 fixtures)
Behavior implemented: facilities.asset.upsert, maintenance.request, maintenance.assign, maintenance.close over 0075's assets/maintenance_requests. No `module` field (lane B ruling: MOD not merged). Audits ids/status only, never issue/location/notes.
Tests run: pnpm test:db tests/db/facilities-actions.test.ts -> 3/3 pass. pnpm test:security tests/security/escalation.test.ts -> 851/852 pass (1 pre-existing fail: registry.size 85 vs static count 90, caused by other agents' calendar/lifecycle/question-bank actions not yet in all-actions.ts manifest — not facilities). pnpm test tests/unit/action-names-unique.test.ts -> 2/4 fail, same pre-existing cause (calendar.event.*, questionBank.list missing from manifests, not mine).
Tests not run: full test:db/test:security (lane rule).
Limitations / honesty label: none (M13 sends no messages, rulings §Honesty).
Security / integration risks: none introduced; RLS/guard enforcement is 0075's (T2), verified via cross-institution assignee -> forbidden, closed->edit -> invalid_state.
Follow-ups: none new; debt rows already listed in rulings (assignment history, no GPS, etc.) belong to controller's post-T13 pass.
New dependencies: none.
Assumptions made: ctx.membership.staffId used as a valid own-institution staff id for assign tests (buildContext helper). Ignored pre-existing typecheck errors in src/modules/lifecycle/actions.ts and src/modules/transport/queries.ts, and a lint warning in tests/db/facilities-queries.test.ts — none are files I touched.
