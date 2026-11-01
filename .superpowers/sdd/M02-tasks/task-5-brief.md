### Task 5: M02-T5 exams + finance query defs
READ: BRIEF-COMMON.md; Task 3 rules; `src/modules/{exams,finance}/queries.ts`
FILES: `src/modules/exams/query-defs.ts` (new); `src/modules/finance/query-defs.ts` (new); `all-queries.ts` (2 import lines)
EXPORTS: every exported async ctx fn per Task 3 rules. Finance `listDefaulters`/`termCollectionSummary` take `{ termId }`. Money stays integer paise as returned.
TEST FIRST: completeness RED → GREEN as T4.
ACCEPT: `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

