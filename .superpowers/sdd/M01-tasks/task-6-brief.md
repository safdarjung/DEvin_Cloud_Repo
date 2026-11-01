### Task 6: M01-T6 GET /api/v1/actions reference
READ: BRIEF-COMMON.md; T4 route; zod 4.6 `z.toJSONSchema` (Context7 or `node_modules/zod` d.ts)
FILES: `src/app/api/v1/actions/route.ts` (new); `tests/unit/api-actions-list.test.ts` (new)
EXPORTS: `runtime`, `dynamic`, `GET(request)`: claims via `getClaims()` (inside `withBearerToken` when a bearer is present) → null → 401; else `apiResponse(ok(list))`, list sorted by name, `inputSchema = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })`.
TEST FIRST (mock `@/lib/supabase/server`: `getClaims` toggled, `withBearerToken` passthrough): no claims → 401; signed in → 200 and contains `admissions.enquiry.note` with `permission: "admissions.enquiry.write"` and `inputSchema.type === "object"`; every registered action appears and serialises (count equals registry size).
ACCEPT: `pnpm test tests/unit/api-actions-list.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

---

Opus after T6: security-reviewer pass on the M1 diff (auth surface); full gate per plan §4.6; D40–D44 into `docs/planning/coolskool/12-decision-log.md`; tracker row; commit `feat(fabric): M01 API dispatcher for actions`; `DONE M01 <sha>`.
