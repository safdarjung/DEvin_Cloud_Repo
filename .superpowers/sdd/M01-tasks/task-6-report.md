# Task 6 report — M01-T6 GET /api/v1/actions reference

Files changed:
- `src/app/api/v1/actions/route.ts` (new)
- `tests/unit/api-actions-list.test.ts` (new)

Behavior implemented:
- `GET` reads bearer token (via `bearerToken`), resolves claims through `getClaims()` — wrapped in `withBearerToken(token, getClaims)` when a bearer is present, plain `getClaims()` otherwise.
- No claims -> `apiResponse(fail("unauthenticated", ...), 401)`.
- Signed in -> builds list from `getActionMeta()`: `{ name, permission, inputSchema }` per entry, `inputSchema = z.toJSONSchema(meta.schema, { io: "input", unrepresentable: "any" })`, sorted by `name` (plain `<`/`>` string comparison, not `localeCompare` — see TDD note below), returned via `apiResponse(ok(list))`.
- `runtime = "nodejs"`, `dynamic = "force-dynamic"` exported, `./all-actions` imported for its side effect (populates registry before `getActionMeta()` read).

TDD note: first sort implementation used `a.name.localeCompare(b.name)`; RED->GREEN cycle (test asserting `body.data` names deeply equal `[...names].sort()`) caught that `localeCompare` and plain `.sort()` order `"exam.marks.enter"` vs `"exam.marks_entry.close"` differently (locale ignores `.`/`_` weight differently than UTF-16 code units). Switched to a plain `<`/`>` comparator so the dispatcher's declared order matches the ordinary JS string sort a caller would expect.

Tests run:
- RED: `pnpm test tests/unit/api-actions-list.test.ts` — failed, `Cannot find package '@/app/api/v1/actions/route'` (route didn't exist yet).
- GREEN (after route + sort fix): `pnpm test tests/unit/api-actions-list.test.ts` → 3 passed (3). Covers: no claims -> 401; signed in -> 200, every registered action present (`body.data.length === getActionMeta().size`), sorted by name, `admissions.enquiry.note` present with `permission: "admissions.enquiry.write"` and `inputSchema.type === "object"`; signed in with bearer token -> 200 (`withBearerToken` passthrough).
- `pnpm lint` → clean.
- `pnpm typecheck` → clean (`next typegen && tsc --noEmit`, no errors).

Tests not run and why: `pnpm test:db`, `pnpm test:security`, `pnpm test:e2e` — out of scope for a unit-only task (no DB touched); brief specifies unit test only.

`z.toJSONSchema` throws check: none. Test 2 round-trips every currently registered action's schema through the real route (not special-cased or try/caught) and asserts the full count serializes and returns 200 — if any schema threw, that test would fail. No action named as a concern.

Limitations / honesty label: n/a — reference/manifest endpoint, no simulated or limited data.

Security / integration risks: endpoint requires authentication (any signed-in caller, no permission gate) before listing action names/permissions/schemas — intentional per brief (a reference manifest), matches T4's reference check, nothing sensitive (no secrets, no row data) in the payload.

Follow-ups: none identified.

New dependencies (justification): none.

Assumptions made: sort order for `name` uses plain UTF-16 code-unit comparison (not locale-aware) — matches default `Array.prototype.sort()` semantics and the test's expectation; brief didn't specify which comparator.
