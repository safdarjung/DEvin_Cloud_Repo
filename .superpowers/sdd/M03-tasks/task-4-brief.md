### Task 4: M03-T4 POST /api/v1/institutions
READ: BRIEF-COMMON.md; `src/lib/http/dispatch.ts`; `src/app/api/v1/actions/[name]/route.ts`; `tests/db/api-actions-route.test.ts`
FILES: `src/app/api/v1/institutions/route.ts` (new); `src/modules/core/schemas.ts` (edit: `CreateInstitutionSchema` {name, slug, timezone?, yearStart? (iso date)}); `tests/db/api-institutions-route.test.ts` (new)
EXPORTS: `POST` — `readPostBody` (Origin + cap) → Zod (`validation_failed` 422 with fieldErrors) → claims via `getClaims()` inside `withBearerToken` when a bearer is present (401 if none) → `supabase.rpc("create_institution", …)` with the caller's client → `mapSqlError` on error → `apiResponse(ok({ institutionId, slug }))`. Body `{ input: {...} }` (no `institution` field).
TEST FIRST: brand-new user with bearer → 200 and then `POST /api/v1/actions/core.feature.set` (or any owner-only action) with that slug succeeds; no token → 401; reserved slug → 422; duplicate → 409; cross-site Origin → 403.
ACCEPT: `pnpm test:db tests/db/api-institutions-route.test.ts`; `pnpm lint`; `pnpm typecheck`

