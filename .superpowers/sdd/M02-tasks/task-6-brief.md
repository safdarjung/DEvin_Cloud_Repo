### Task 6: M02-T6 notifications + jobs + ai + website query defs
READ: BRIEF-COMMON.md; Task 3 rules; `src/modules/{notifications,jobs,ai,website}/queries.ts`
FILES: `src/modules/{notifications,jobs,ai,website}/query-defs.ts` (4 new, each ≤ 40 lines); `all-queries.ts` (4 lines)
EXPORTS: tenant (ctx) fns only. Website public fns (`getPublicSite`, `getPublicPage`, `listPublicNotices`, `listPublicEvents`) are skipped — the public site has its own anon path.
TEST FIRST: completeness RED → GREEN as T4.
ACCEPT: `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

