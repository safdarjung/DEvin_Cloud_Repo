### Task 5: M01-T5 Registry metadata (schema + permission)
READ: BRIEF-COMMON.md; `src/lib/actions/{registry,define-action}.ts`; `tests/unit/define-action.test.ts`
FILES: `src/lib/actions/registry.ts` (edit); `src/lib/actions/define-action.ts` (edit); `tests/unit/define-action.test.ts` (edit)
EXPORTS: `registerAction(name, action, meta?: ActionMeta)`; `type ActionMeta = { schema: z.ZodType; permission: Permission | null }` (null when the permission is a function of input); `getActionMeta(): ReadonlyMap<string, ActionMeta>`. `getRegisteredActions()` unchanged (escalation suite uses it). defineAction passes meta. First registration wins, same as today.
TEST FIRST: "defineAction records its schema and static permission"; "function permission is recorded as null".
ACCEPT: `pnpm test tests/unit/define-action.test.ts tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

