# M01 — API dispatcher for actions (D40)

Source: `07-master-plan-v1-v2.md` §2 D40, §3 M1. No migration. No new deps. Spec: `docs/planning/coolskool/06-workflows-and-contracts.md` §1, `07-security-and-ai-governance.md` §3.

Wire contract (all tasks agree on this):

```
POST /api/v1/actions/<name>
  headers: content-type: application/json
           Authorization: Bearer <supabase access token>   (optional; else session cookie)
           x-institution: <slug>                            (optional; else body.institution)
  body:    { "institution"?: "<slug>", "input": <action input> }
  200 { ok: true, data } | 4xx/5xx { ok: false, error: { code, message, fieldErrors? } }
GET  /api/v1/actions   → { ok: true, data: [{ name, permission, inputSchema }] }   (signed-in only)
```

Order: T1, T2, T3 independent (parallel ok; T2 is the only DB user) → T4 → T5 → T6 → Opus docs.

---

### Task 1: M01-T1 ErrorCode→HTTP envelope
READ: BRIEF-COMMON.md; `src/lib/actions/result.ts`
FILES: `src/lib/http/api-envelope.ts` (new)
EXPORTS: `HTTP_STATUS: Record<ErrorCode, number>` (use `satisfies`, exhaustive): unauthenticated 401, forbidden 403, not_found 404, validation_failed 422, conflict 409, invalid_state 409, rate_limited 429, quota_exceeded 429, ai_unavailable 503, ai_policy_blocked 403, ai_invalid_output 502, dependency_failed 502, internal 500 · `apiResponse(result: ActionResult<unknown>, status?: number): Response` (status overrides the mapped code — T4 uses it for 400/413; else 200 on ok, else `HTTP_STATUS[code]`; JSON body = the envelope unchanged; `cache-control: no-store`) · `bearerToken(request: Request): string | null` (case-insensitive `Bearer <token>`, trims, null on empty/malformed).
TEST FIRST: `tests/unit/api-envelope.test.ts` — every ErrorCode maps to a 4xx/5xx; ok result → 200 with body `{ok:true,data}`; fail result keeps fieldErrors; bearerToken parses `bearer abc`, rejects `Basic x` / `Bearer ` / missing.
ACCEPT: `pnpm test -- tests/unit/api-envelope.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: M01-T2 Bearer-token server client
READ: BRIEF-COMMON.md; `src/lib/supabase/server.ts`; `src/lib/auth/context.ts`; `tests/helpers/roles.ts`
FILES: `src/lib/supabase/server.ts` (edit); `tests/db/bearer-client.test.ts` (new)
EXPORTS: `withBearerToken<T>(token: string, fn: () => Promise<T>): Promise<T>` — `AsyncLocalStorage` (node:async_hooks), module-private store. While a token is in scope: `createClient()` returns plain supabase-js (`global.headers.Authorization = Bearer <token>`, `auth: { persistSession: false, autoRefreshToken: false }`) and never calls `cookies()`; `getClaims()` calls `supabase.auth.getClaims(token)` (verifies the JWT; never decode-only). Outside the scope behaviour is byte-for-byte unchanged. Scope is opt-in only (never read the `Authorization` header globally — only the dispatcher calls `withBearerToken`). Keep `createClient`'s return type usable by every existing caller (typecheck whole repo).
TEST FIRST: cases — "getClaims inside withBearerToken returns the token's user"; "garbage token → getClaims null"; "createClient under a teacher token reads memberships as that teacher only (RLS)"; "scope does not leak after fn resolves" (call outside with `next/headers` mocked to an empty cookie jar → getClaims null). Get tokens via `inst.clientAs(role).auth.getSession()`.
ACCEPT: `pnpm test:db -- tests/db/bearer-client.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: M01-T3 Action manifest + registry completeness
READ: BRIEF-COMMON.md; `src/lib/actions/registry.ts`; `tests/unit/action-names-unique.test.ts`; imports at top of `tests/security/escalation.test.ts`
FILES: `src/app/api/v1/actions/all-actions.ts` (new); `tests/unit/action-names-unique.test.ts` (edit, add one `it`)
EXPORTS: `all-actions.ts` = side-effect imports of every `src/modules/**/*actions.ts` (10 today, same list as escalation.test.ts) + one-line comment "every new action file must be imported here". No other exports.
TEST FIRST: new case "every defineAction name is registered after importing the dispatcher manifest" — opt-in `vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"))`, import `@/app/api/v1/actions/all-actions`, assert `new Set(getRegisteredActions().keys())` equals the statically collected names (reuse the file's walk/regex). Prove RED by temporarily omitting one import.
ACCEPT: `pnpm test -- tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 4: M01-T4 POST /api/v1/actions/[name]
READ: BRIEF-COMMON.md; `node_modules/next/dist/docs` route-handler page (params are a Promise in 16.x); `src/app/api/public/enquiry/route.ts` (mirror style, runtime/dynamic exports); `src/lib/http/request.ts`; `src/lib/actions/define-action.ts` (isNextControlFlowSignal); `tests/db/public-enquiry-route.test.ts`, `tests/db/admissions-actions.test.ts` (fixture for an enquiry)
FILES: `src/app/api/v1/actions/[name]/route.ts` (new); `tests/db/api-actions-route.test.ts` (new)
EXPORTS: `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `POST(request, { params })`. Steps: `isCrossSiteRequest` → 403 forbidden · `readJsonBody(request, 1_000_000)` → 413 (`validation_failed`, "Request body too large.") / 400 on bad JSON · Zod body `{ institution?: string, input?: unknown }` · slug = `x-institution` header ?? body.institution, validated like website `SLUG_PATTERN`, max 100 → 422 · action = `getRegisteredActions().get(name)` after importing `../all-actions` → 404 not_found · run `action(slug, input)` inside `withBearerToken` when `bearerToken(request)` is non-null · catch Next control-flow digests: `NEXT_REDIRECT…` → 401 unauthenticated, `NEXT_HTTP_ERROR_FALLBACK;404` → 404 not_found; anything else → 500 internal with correlation id logged (no raw error text) · `apiResponse(result)`. Never pass a 3rd argument to the action.
TEST FIRST (call the real exported POST, `vi.mock("next/headers")` with an empty cookie jar): admissions-role bearer adds a note to an enquiry → 200 and row exists; teacher bearer → 403 forbidden; accountant bearer → 403; no token → 401; bearer of a member of another institution → 404; unknown action → 404; invalid input → 422 with fieldErrors; `Origin: https://evil.example` → 403 (this is the dispatcher CSRF case; note it in the report).
ACCEPT: `pnpm test:db -- tests/db/api-actions-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 5: M01-T5 Registry metadata (schema + permission)
READ: BRIEF-COMMON.md; `src/lib/actions/{registry,define-action}.ts`; `tests/unit/define-action.test.ts`
FILES: `src/lib/actions/registry.ts` (edit); `src/lib/actions/define-action.ts` (edit); `tests/unit/define-action.test.ts` (edit)
EXPORTS: `registerAction(name, action, meta?: ActionMeta)`; `type ActionMeta = { schema: z.ZodType; permission: Permission | null }` (null when the permission is a function of input); `getActionMeta(): ReadonlyMap<string, ActionMeta>`. `getRegisteredActions()` unchanged (escalation suite uses it). defineAction passes meta. First registration wins, same as today.
TEST FIRST: "defineAction records its schema and static permission"; "function permission is recorded as null".
ACCEPT: `pnpm test -- tests/unit/define-action.test.ts tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 6: M01-T6 GET /api/v1/actions reference
READ: BRIEF-COMMON.md; T4 route; zod 4.6 `z.toJSONSchema` (Context7 or `node_modules/zod` d.ts)
FILES: `src/app/api/v1/actions/route.ts` (new); `tests/unit/api-actions-list.test.ts` (new)
EXPORTS: `runtime`, `dynamic`, `GET(request)`: claims via `getClaims()` (inside `withBearerToken` when a bearer is present) → null → 401; else `apiResponse(ok(list))`, list sorted by name, `inputSchema = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })`.
TEST FIRST (mock `@/lib/supabase/server`: `getClaims` toggled, `withBearerToken` passthrough): no claims → 401; signed in → 200 and contains `admissions.enquiry.note` with `permission: "admissions.enquiry.write"` and `inputSchema.type === "object"`; every registered action appears and serialises (count equals registry size).
ACCEPT: `pnpm test -- tests/unit/api-actions-list.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

---

Opus after T6: security-reviewer pass on the M1 diff (auth surface); full gate per plan §4.6; D40–D44 into `docs/planning/coolskool/12-decision-log.md`; tracker row; commit `feat(fabric): M01 API dispatcher for actions`; `DONE M01 <sha>`.
