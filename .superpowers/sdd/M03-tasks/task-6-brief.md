### Task 6: M03-T6 POST /api/v1/invitations/accept
READ: BRIEF-COMMON.md; Task 4 route (mirror exactly)
FILES: `src/app/api/v1/invitations/accept/route.ts` (new); `src/modules/core/schemas.ts` (edit: `AcceptInvitationSchema` {token: 64 hex}); `tests/db/api-invitation-accept-route.test.ts` (new)
EXPORTS: `POST` same shape as Task 4 → `accept_invitation` → `apiResponse(ok({ membershipId, institutionSlug }))` (slug looked up after accept with the caller's client).
TEST FIRST: invited user (auth user created with the invited email) accepts with bearer → 200, then a teacher-permitted query via `/api/v1/query/...` with that slug → 200; reused token → 409/invalid_state mapping; no token → 401; malformed token → 422.
ACCEPT: `pnpm test:db tests/db/api-invitation-accept-route.test.ts`; `pnpm lint`; `pnpm typecheck`

