# X01-T8 Diary actions — completion report

Packet: X01-T8 Diary actions
Files changed:
- `src/modules/diary/actions.ts` (new)
- `tests/db/diary-actions.test.ts` (new)
- `src/app/api/v1/actions/all-actions.ts` (+1 import, alphabetical)
- `tests/security/escalation.test.ts` (+3 C-03 fixtures)

Behavior implemented: `diary.entry.post` (insert, created_by=caller, 42501→forbidden "You do not teach this section.", audit `diary.entry.posted`, returns `{id}`); `diary.entry.delete` (select-then-delete split so invisible row→`not_found`, visible-but-undeletable→`forbidden`; audit `diary.entry.deleted`); `diary.acknowledge` (select entry for visibility/`requires_ack`, insert ack, 23505→success, 42501→`forbidden`, no audit per ruling). All module `diary`, mirror `people/leave.actions.ts` (isRlsViolation) + `announcements.actions.ts` style.

Tests run: `pnpm test:db tests/db/diary-actions.test.ts` → 1 file, 10/10 passed. `pnpm test tests/unit/action-names-unique.test.ts` → 6/6 passed. `pnpm test:security tests/security/escalation.test.ts` → 1213/1222 passed; 9 pre-existing failures all under `ptm.event.create` (another lane's concurrent fixture, file/rows I did not touch — all `diary.*`/`studentLeave.*` rows pass). `pnpm lint` → clean (2 warnings in unrelated `tests/db/survey-queries.test.ts`, not mine). `pnpm typecheck` → clean.

Tests not run and why: none blocked for this packet.

Limitations / honesty label: none; no UI, no honesty badge applicable.

Security / integration risks: none identified. `diary.entry.delete`'s not_found/forbidden split relies on two round-trips (select then delete) under the same RLS session — correct but not atomic; acceptable since no state changes between them within one request.

Follow-ups: T9 diary queries, T10 templates/handlers depend on this file's exports; none new from me.

New dependencies: none.

Assumptions made: "other-section teacher → not_found" and "non-author teacher → forbidden" tests built two-section fixtures directly (bare staff + raw-SQL seeded entries) since the role fixture gives one "teacher" account per institution — same technique `diary-rls.test.ts` (T5) used for RLS-only cases.
