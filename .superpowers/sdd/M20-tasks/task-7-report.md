Packet: M20-T7 Action `exam.paper.setUnits`
Files changed: `src/modules/exams/paper-units.actions.ts` (new); `tests/db/exam-paper-units-actions.test.ts` (new); `src/app/api/v1/actions/all-actions.ts` (+1 import line); `tests/security/escalation.test.ts` (+1 C-03 fixture)
Behavior implemented: `defineAction` wraps `exam_papers.unit_ids` update, `exam.manage` gate, `module: "mastery"`; 0 rows → `not_found`; trigger `code:validation_failed` → `validation_failed` + `fieldErrors.unitIds`; audit `exam.paper.units_set {paperId, unitCount}`; returns `{paperId, unitIds}`.
Tests run: `pnpm test:db tests/db/exam-paper-units-actions.test.ts` 5/5 pass; `pnpm test tests/unit/action-names-unique.test.ts` 6/6 pass; `pnpm test:security tests/security/escalation.test.ts` 1532/1532 pass; `pnpm lint` 0 errors (pre-existing warnings elsewhere only); `pnpm typecheck` clean for my files.
Tests not run and why: none — all ACCEPT commands ran.
Limitations / honesty label: none new; mastery `limited` badge lands with T15's UI pass.
Security / integration risks: none new; RLS + trigger (T4) do the real enforcement, action is a thin pass-through.
Follow-ups: none new.
New dependencies: none.
Assumptions made: mapped the trigger's `code:validation_failed` to `fieldErrors.unitIds` message per packet spec, not the trigger's own detail text.

Other files seen but not touched (concurrent agents, pre-existing typecheck error only):
`src/modules/mastery/queries.ts` TS2322 x2 (string|null not assignable) — not my file, named per BRIEF-COMMON.
