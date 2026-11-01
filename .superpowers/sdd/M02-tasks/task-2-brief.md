### Task 2: M02-T2 Shared dispatch helper (refactor)
READ: BRIEF-COMMON.md; `src/app/api/v1/actions/[name]/route.ts`; `src/app/api/v1/actions/route.ts`
FILES: `src/lib/http/dispatch.ts` (new); `src/app/api/v1/actions/[name]/route.ts` (edit); `src/app/api/v1/actions/route.ts` (edit)
EXPORTS: move logic out of the two routes, unchanged in behaviour: `readPostBody(request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }>` (Origin check, 1 MB cap, 400/413) · `dispatchCall(request, name, registry: ReadonlyMap<string, AnyAction>, body: unknown): Promise<Response>` (body schema, slug from `x-institution` ?? body.institution, lookup → 404, `withBearerToken` when bearer present, control-flow digests → 401/404, else 500 with correlation id) · `listResponse(request, meta: ReadonlyMap<string, ActionMeta>): Promise<Response>` (the GET listing incl. 401). Routes become ≤ 15 lines each.
TEST FIRST: none new — this is a pure refactor; the safety net is the existing suites.
ACCEPT: `pnpm test:db tests/db/api-actions-route.test.ts` (8/8, unchanged file); `pnpm test tests/unit/api-actions-list.test.ts`; `pnpm lint`; `pnpm typecheck`

