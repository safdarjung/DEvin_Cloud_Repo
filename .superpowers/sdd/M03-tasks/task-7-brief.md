### Task 7: M03-T7 core.member.setRole / core.member.setStatus
READ: BRIEF-COMMON.md; `…0033*`, `…0038*` (guard rules); `src/modules/core/actions.ts`
FILES: `src/modules/core/actions.ts` (edit); `src/modules/core/schemas.ts` (edit); `tests/db/member-manage-actions.test.ts` (new)
EXPORTS: `core.member.setRole` {membershipId, role ∈ staff-class roles} — only between staff-class roles (link unchanged); `core.member.setStatus` {membershipId, status: active|disabled}. Both `member.manage`, update `memberships` with the caller's client (RLS + guard decide), `.select().single()` so a hidden row → not_found, audit `core.member.role_set` / `core.member.status_set`.
TEST FIRST: principal moves a teacher to exam_controller → ok; admin sets someone to owner → forbidden; admin edits own membership → forbidden; teacher → forbidden; disabled member's `getTenantContext` → not_found (portal access lost).
ACCEPT: `pnpm test:db tests/db/member-manage-actions.test.ts`; `pnpm lint`; `pnpm typecheck`

