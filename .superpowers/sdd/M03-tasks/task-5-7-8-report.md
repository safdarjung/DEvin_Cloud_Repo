# M03 Tasks 5, 7, 8 — report

## Task 5: core.member.invite / core.member.revokeInvite

Files: `src/modules/core/actions.ts` (edit), `src/modules/core/schemas.ts` (edit, `InviteMemberSchema`/`RevokeInvitationSchema`), `tests/db/member-invite-actions.test.ts` (new).

RED: wrote the 4 tests first (admin invite ok, teacher forbidden, admin-invites-owner forbidden, revoke+re-revoke) against the not-yet-written actions — failed on missing exports.
GREEN: implemented `inviteMember`/`revokeInvite` as thin RPC wrappers over `invite_member`/`revoke_invitation` (0079). Hit one real bug: the audit action string `"core.member.revokeInvite"` (camelCase, matching the defineAction *name*) fails `record_audit_event`'s `^[a-z_]+(\.[a-z_]+)+$` check — renamed the audit action (not the registered action name) to `core.member.revoke_invite`. All 4 tests green after that fix.

## Task 7: core.member.setRole / core.member.setStatus

Files: `src/modules/core/actions.ts` (edit), `src/modules/core/schemas.ts` (edit, `SetMemberRoleSchema` restricted to `app.staff_roles()`, `SetMemberStatusSchema`), `tests/db/member-manage-actions.test.ts` (new, 5 tests).

Direct RLS writes on `memberships` (0002's `memberships_update` policy + `app.guard_membership_write` 0033/0038 do the self-edit/owner/principal-escalation enforcement). Used `.maybeSingle()` + explicit `if (!data) throw not_found`, not `.single()` — `.single()` raises PGRST116 on a zero-row update, which `mapSqlError` has no `code:` prefix to map, turning it into `internal` and making not_found dead code. This mirrors the fix-round-1 lesson already recorded in `website.notice.upsert`/`website.event.upsert` (same comment copied in). All 5 tests green first run.

The "disabled member's getTenantContext → not_found" TEST FIRST item is tested at the DB layer (confirms the disabled row no longer matches `status = 'active'`, the exact clause `getTenantContext` joins on) rather than driving `getTenantContext`'s `notFound()`/`next/navigation` control flow from a non-request DB test — that function is pre-existing (T-007), unchanged here, and asserting its Next.js-coupled behavior would need mocking `next/navigation` for no new coverage.

## Task 8: academic year / term / institution settings actions

Files: `src/modules/core/actions.ts` (edit), `src/modules/core/schemas.ts` (edit, `AcademicYearUpsertSchema`/`TermUpsertSchema`/`UpdateInstitutionSettingsSchema`), `tests/db/core-setup-actions.test.ts` (new, 6 tests).

- `core.academicYear.upsert`: update when `id` given else insert; `isCurrent: true` first clears the institution's existing current row (partial unique index `academic_years_one_current_idx` would otherwise conflict).
- `core.term.upsert`: brief's input shape has no `sequence` field, but `terms.sequence` is `not null` — handler derives it (`count(*) for that academic_year_id + 1`) on insert only; untouched on update. `app.validate_term_dates` (0002 trigger) enforces the term-inside-year rule, surfaced as `validation_failed` via `mapSqlError`.
- `core.institution.updateSettings`: `timezone` is a convenience field mapped into `settings.locale.timezone` (there's no separate `institutions.timezone` column — it only lives inside the JSON `settings.locale`); `settings` is an optional deep-ish patch validated with `InstitutionSettingsSchema.partial()` (top-level keys optional, but a present key must still be the full valid shape for that key — same per-key-strictness idea as `setFeatureEnabled`'s `features` patch). Verified in isolation that `.strict().partial()` still rejects unknown top-level keys in zod 4.6.7.

All 6 tests green first run (no RED→fix cycle needed once the Task 5/7 patterns were established).

## Shared helper

Added `throwMapped(error)` to `src/modules/core/actions.ts` (mirrors the identical helper already in `admissions/actions.ts`/`attendance/actions.ts`) and used it in all six new handlers instead of repeating the inline `mapSqlError`/`AppError` block six times. Left `setFeatureEnabled`'s pre-existing inline block untouched (out of this packet's scope).

## Tests run

- `pnpm test:db tests/db/member-invite-actions.test.ts` → 4 passed
- `pnpm test:db tests/db/member-manage-actions.test.ts` → 5 passed
- `pnpm test:db tests/db/core-setup-actions.test.ts` → 6 passed
- `pnpm test tests/unit/action-names-unique.test.ts` → 4 passed
- `pnpm lint` → clean
- `pnpm typecheck` → clean

## Concerns / assumptions

- No migrations touched; no `db:reset`/`db:types` run (not needed — no new RPCs or columns).
- `InviteMemberSchema.role` allows all 9 membership roles (matches `invite_member`'s own validation, 0079) — only `SetMemberRoleSchema.role` is narrowed to `app.staff_roles()` per the Task 7 brief ("only between staff-class roles").
- `core.term.upsert`'s auto-sequence is a shortcut: it reads `count(*)` then inserts, not inside one transaction with the unique `(academic_year_id, sequence)` constraint as a safety net — two concurrent first-term inserts for the same year would 23505 one of them (mapped to `internal`, not a friendly `conflict`). No test for this race; out of scope for M03 (single-admin setup flow), flagging for `12-decision-log.md` §Debt if it matters later.
- No new dependencies.
