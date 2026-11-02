Packet: M11-T8 Query `questionBank.list`
Files changed: src/modules/question-bank/queries.ts (new), src/modules/question-bank/query-defs.ts (new), tests/db/question-bank-queries.test.ts (new); all-queries.ts +1 import line; tests/db/api-query-route.test.ts +1 smoke sample line.
Behavior implemented: `listQuestions(ctx, filters)` — paged, counted `question_bank` select joined to subjects/grades/curriculum_units, institution_id filter + is_active/subject/grade/unit/type/difficulty filters, order updated_at desc. `questionBank.list` def: permission `question.manage`, module `question_bank` (RLS 0073 does real scoping; teacher sees only taught grade/subject, guardian/student blocked by permission gate before DB).
Tests run: `pnpm test:db tests/db/question-bank-queries.test.ts` → 6/6 pass. `pnpm test:db tests/db/api-query-route.test.ts` → 7/7 pass (owner smoke incl. questionBank.list). `pnpm lint` clean. `pnpm typecheck` clean for touched files.
Tests not run and why: no db:reset/seed/db:types/full test:db — not DB owner this task.
Limitations / honesty label: none; read-only, no UI, no label needed.
Security / integration risks: none new — relies on existing 0073 RLS; permission gate blocks guardian/student/admin before any query.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: `module` field is doc-only (no runtime param on defineQuery/defineAction in this codebase) — confirmed against define-action.ts/define-query.ts signatures.

Pre-existing, unrelated: `pnpm typecheck` fails on `src/modules/lifecycle/actions.ts` and `tests/db/lifecycle-queries.test.ts` (another agent's files, untouched by this task) — not fixed per brief ("ignore lint/type errors in files you did not touch; name them").
