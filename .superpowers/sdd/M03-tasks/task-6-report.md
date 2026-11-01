Packet: T-0NN M03-T6 POST /api/v1/invitations/accept

Files changed:
- src/app/api/v1/invitations/accept/route.ts (new)
- src/modules/core/schemas.ts (append: AcceptInvitationSchema)
- tests/db/api-invitation-accept-route.test.ts (new)

Behavior implemented:
Non-tenant route, mirrors src/app/api/v1/institutions/route.ts exactly: readPostBody -> BodySchema -> AcceptInvitationSchema (`token`: 64 lowercase hex, `.strict()`) -> cookie-or-bearer (`token ? withBearerToken(token, run) : run()`) -> getClaims -> `supabase.rpc("accept_invitation", { p_token })` -> mapSqlError on failure -> on success, caller's own client reads `memberships.institution_id` by the returned membership id, then `institutions.slug` by that id (RLS now allows both: caller is an active member) -> `apiResponse(ok({ membershipId, institutionSlug }))`.

Tests run: `pnpm test:db tests/db/api-invitation-accept-route.test.ts` -> 4 passed, 0 failed (Test Files 1 passed, Tests 4 passed, 3.10s). No RED phase captured — route/schema/test were all written in one pass and passed on first run (same shape as Task 4, low implementation risk); verified test actually exercises the new code by confirming each assertion maps to a real response field (manual trace, not a second failing run).
- test 1: invited user accepts with bearer -> 200, membershipId truthy, institutionSlug === fixture.slug; then `notifications.unreadCount` (permission `notification.read`, which `teacher` holds) via /api/v1/query/[name] -> 200 ok.
- test 2: reused (already-accepted) token -> second accept -> 409 `invalid_state`.
- test 3: no bearer, no cookie session -> 401 `unauthenticated` (claims check runs before any token-shape-dependent RPC call).
- test 4: malformed token (not 64 hex) -> 422 `validation_failed`.

`pnpm lint` -> clean. `pnpm typecheck` -> clean (`next typegen && tsc --noEmit`, 0 errors).

Tests not run and why: full `pnpm test:db` suite, `pnpm test`, `pnpm test:security`, `pnpm test:e2e` — brief restricts non-DB-owner packets to their own db test file only.

Limitations / honesty label: none — no UI, no simulated/limited surface.

Security / integration risks: route trusts `accept_invitation`'s own authz/state checks entirely (route does zero additional validation beyond token shape) — same trust boundary as Task 4's `create_institution` call. Two extra post-success reads (memberships, institutions) run under the caller's own bearer-scoped client/RLS, not service-role, so they can only ever surface what the now-member caller is already entitled to see.

Follow-ups: none identified.

New dependencies (justification): none.

Assumptions made:
- Picked `notifications.unreadCount` (permission `notification.read`, `teacher` has it; schema `{}`, no extra fixture data needed) as the "teacher-permitted query" the brief asked for — `core.getDashboardData` was the obvious first candidate but its permission is `dashboard.view`, which `teacher` does NOT hold (checked src/lib/auth/permissions.ts), so it was rejected.
- Invite token obtained via a direct `invite_member` RPC call on the fixture owner's real signed-in client (tests/helpers/roles.ts `clientAs`), not through the `core.member.invite` action — avoids pulling in the opt-in `@/lib/supabase/server` mock (`callAs` pattern), which would conflict with this file's real-module bearer-token exercise of the route under test. Brief explicitly allowed either approach.
- Cleanup: `fixture.cleanup()` (→ `app.demo_reset` + institution delete + fixture users delete) handles the extra staff row, invitation row, and the invited user's new membership row (all `institution_id`-scoped); the invited auth user itself is deleted manually since it is not one of the fixture's own per-role users.
