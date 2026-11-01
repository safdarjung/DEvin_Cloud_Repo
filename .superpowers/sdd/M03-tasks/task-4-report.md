Packet: T-0NN M03-T4 POST /api/v1/institutions

Files changed:
- src/app/api/v1/institutions/route.ts (new)
- src/modules/core/schemas.ts (edit: added CreateInstitutionSchema + type)
- tests/db/api-institutions-route.test.ts (new)

Behavior implemented:
Non-tenant POST route. readPostBody (Origin + 1MB cap + JSON parse) -> Zod
CreateInstitutionSchema on body.input (422 + fieldErrors on failure) ->
bearerToken() from header (401 if absent) -> withBearerToken(token, ...) ->
getClaims() (401 if invalid/expired) -> supabase.rpc("create_institution",
{p_name, p_slug, p_timezone?, p_year_start?}) on the caller's bearer-scoped
client -> mapSqlError on RPC error -> apiResponse(ok({institutionId, slug})).
Body shape `{ input: { name, slug, timezone?, yearStart? } }`, no
`institution` field (route is non-tenant, nothing to resolve a slug from).
CreateInstitutionSchema only validates types/length; reserved-slug/
quota/duplicate business rules stay in create_institution (SQL), per brief.

Tests run:
RED: moved route.ts aside, `pnpm test:db tests/db/api-institutions-route.test.ts`
  -> failed as expected (Cannot find package '@/app/api/v1/institutions/route').
GREEN: restored route.ts, same command -> Test Files 1 passed, Tests 5 passed:
  - brand-new user bearer -> 200, then core.feature.set (owner-only action)
    on that slug -> 200
  - no token -> 401 unauthenticated
  - reserved slug ("admin") -> 422 validation_failed
  - duplicate slug (two users) -> 409 conflict
  - cross-site Origin -> 403 forbidden
`pnpm lint` -> clean. `pnpm typecheck` -> clean (next typegen + tsc --noEmit).

Tests not run and why: full `pnpm test:db` (other packets' suites) — not my
file per BRIEF-COMMON non-owner rule; `pnpm test:security` — not requested
in this task's ACCEPT line (Task 4 only lists lint/typecheck/its own test file).

Limitations / honesty label: n/a — no simulated/limited UI surface here.

Security / integration risks: route trusts getClaims() (re-validated JWT,
not getSession) same as the action dispatcher; RLS + create_institution's
own checks (quota, reserved slugs, duplicate slug 23505->conflict) are the
real enforcement boundary, this route is a thin pass-through. No new
authorization logic introduced here to review independently.

Follow-ups: none identified beyond M03-T5..T11 already on the task list.

New dependencies (justification): none.

Assumptions made:
- CreateInstitutionSchema's own bounds (name 2-120, slug 3-40) mirror the
  brief's description of create_institution's SQL-side checks but are not
  required to match exactly — RPC is the source of truth for reserved
  slugs/pattern/quota/duplicate; Zod here only rejects malformed JSON
  shapes before a network round trip.
- timezone/yearStart passed to the RPC only when present in the parsed
  input (spread), so RPC defaults (`Asia/Kolkata`, current-year start)
  apply when omitted, per the RPC signature's own defaults.
