Packet: X06-T8 Queries `examSeating.chartHtml`, `examSeating.admitCardsHtml`

Files changed:
- `src/modules/exam-seating/queries.ts` (+`getAdmitCards`)
- `src/modules/exam-seating/query-defs.ts` (+2 defs)
- `tests/db/exam-seating-html.test.ts` (new)
- `tests/db/api-query-route.test.ts` (+2 owner-smoke sample lines, edit-only)

Behavior implemented: `getAdmitCards(ctx, {examId, classSectionId, studentId?})` — section's papers with `scheduled_at` set (time order), active students (roll_no then admission_no), seat from the current plan of each slot or null ("To be announced"). `examSeating.chartHtml` wraps T6 `getSeatingChart` + T7 `renderSeatingChartHtml`; `examSeating.admitCardsHtml` wraps `getAdmitCards` + `renderAdmitCardsHtml`; both `{ html } | null`.

Tests run: `pnpm test:db tests/db/exam-seating-html.test.ts` → 1/1 pass (room name + seated student name in chart; 2 cards, planned-seat-before-TBA ordering, studentId→1 card, guardian→null, other institution→null). `pnpm test:db tests/db/api-query-route.test.ts` → 7/7 pass. `pnpm test:security tests/security/module-gate.test.ts` → 235/235 pass. `pnpm lint` clean. `pnpm typecheck` 0 errors.

Tests not run and why: full `test:db`/`test:security` suites — DB-owner rule, single-file only.

Limitations / honesty label: n/a (API layer; feature stays `limited`, rule 7 unaffected).

Security / integration risks: none new. Guardian/student null for admitCardsHtml comes from `exam_papers` RLS (staff-only), not a permission check — verified in test. `institution_id` filters are defense in depth; RLS is the real boundary (T2/T3).

Follow-ups: T9 acceptance-over-HTTP exercises both via `?format=html`.

New dependencies: none.

Assumptions made: seat/slot matching by instant (`getTime()`), not string equality, per T6's documented timestamptz round-trip behavior.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
