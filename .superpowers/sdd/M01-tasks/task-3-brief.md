### Task 3: M01-T3 Action manifest + registry completeness
READ: BRIEF-COMMON.md; `src/lib/actions/registry.ts`; `tests/unit/action-names-unique.test.ts`; imports at top of `tests/security/escalation.test.ts`
FILES: `src/app/api/v1/actions/all-actions.ts` (new); `tests/unit/action-names-unique.test.ts` (edit, add one `it`)
EXPORTS: `all-actions.ts` = side-effect imports of every `src/modules/**/*actions.ts` (10 today, same list as escalation.test.ts) + one-line comment "every new action file must be imported here". No other exports.
TEST FIRST: new case "every defineAction name is registered after importing the dispatcher manifest" — opt-in `vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"))`, import `@/app/api/v1/actions/all-actions`, assert `new Set(getRegisteredActions().keys())` equals the statically collected names (reuse the file's walk/regex). Prove RED by temporarily omitting one import.
ACCEPT: `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

