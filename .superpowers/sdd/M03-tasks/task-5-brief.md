### Task 5: M03-T5 core.member.invite / core.member.revokeInvite actions
READ: BRIEF-COMMON.md; `src/modules/core/actions.ts` (mirror `core.feature.set`); `tests/db/core-actions.test.ts` (callAs pattern)
FILES: `src/modules/core/actions.ts` (edit); `src/modules/core/schemas.ts` (edit); `tests/db/member-invite-actions.test.ts` (new)
EXPORTS: `inviteMember` = `defineAction({ name: "core.member.invite", permission: "member.manage", schema: { email, role, staffId?, guardianId?, studentId? } })` → `invite_member` RPC with `ctx.institution.id` → returns `{ invitationId, token, delivery: "simulated" }` (no channel yet — D42/M17; UI shows the link with `<SimulatedBadge />`). `revokeInvite` = `core.member.revokeInvite` {invitationId} → `revoke_invitation`. Errors via `mapSqlError`.
TEST FIRST: admin invites teacher → ok with 64-hex token; teacher → forbidden (permission layer); admin invites owner → forbidden (SQL layer); revoke → ok, second revoke → invalid_state.
ACCEPT: `pnpm test:db tests/db/member-invite-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

