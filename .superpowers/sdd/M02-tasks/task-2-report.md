### Task 2: M02-T2 Shared dispatch helper (refactor) — report

Files changed:
- `src/lib/http/dispatch.ts` (new) — `readPostBody`, `dispatchCall`, `listResponse`, plus moved-in private helpers `isValidSlug`, `controlFlowStatus`, `BodySchema`, `MAX_BODY_BYTES`, `SLUG_PATTERN`.
- `src/app/api/v1/actions/[name]/route.ts` (edit) — POST now 14 lines: `server-only` + `../all-actions` side-effect import kept, calls `readPostBody` then `dispatchCall`.
- `src/app/api/v1/actions/route.ts` (edit) — GET now 10 lines: `server-only` + `./all-actions` side-effect import kept, calls `listResponse`.

Behaviour: unchanged. All status codes (400/401/403/404/413/500), messages, `cache-control: no-store` header (via unchanged `apiResponse`), the origin/CSRF check, 1 MB cap, slug validation, control-flow digest → 401/404 mapping, and the GET auth + listing/sort logic moved verbatim. Comments explaining why (control-flow digest note, CSRF rationale in request.ts — untouched) moved with their code.

Exports match brief signatures exactly:
- `readPostBody(request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }>`
- `dispatchCall(request, name, registry: ReadonlyMap<string, AnyAction>, body: unknown): Promise<Response>`
- `listResponse(request, meta: ReadonlyMap<string, ActionMeta>): Promise<Response>`

Tests run:
- Baseline (before edit): `pnpm test:db tests/db/api-actions-route.test.ts` → 8/8 pass. `pnpm test tests/unit/api-actions-list.test.ts` → 3/3 pass.
- After edit: same two commands → 8/8 pass, 3/3 pass. No test file touched.
- `pnpm lint` → clean (no output, exit 0).
- `pnpm typecheck` → `next typegen` + `tsc --noEmit` clean.

Tests not run and why: full `pnpm test:db`/`pnpm test:security`/`pnpm test:e2e` suites — out of scope, brief names only the two files; no DB state touched (pure code move, no migrations).

Limitations / honesty label: n/a — no UI, no simulated/limited surface.

Security / integration risks: none identified — logic is a 1:1 move, no behavior branches changed. `dispatchCall`'s internal `/api/v1/actions dispatcher failed` log line kept verbatim even though the function is now shared with the future `/api/v1/query/*` route; M02-T3 (query routes) should confirm that message still reads sensibly for query failures or adjust then, not now (surgical-change scope here).

Follow-ups: none new; M02-T3 (query routes) can now call `dispatchCall`/`readPostBody`/`listResponse` directly for thin routes.

New dependencies (justification): none.

Assumptions made: none — brief's exact exports and file list matched the existing two routes' code 1:1, no ambiguity.
