Packet: M03-T2 — Migration 0079: invite_member / accept_invitation / revoke_invitation RPCs

Files changed:
- `supabase/migrations/20261028000079_invitation_rpcs.sql` (new)
- `tests/db/invitation-rpc.test.ts` (new)
- `src/lib/db/types.ts` (regen, raw `pnpm db:types` output, additions only)
- `tests/security/grants.test.ts` (edit — added `public.accept_invitation`, `public.invite_member`, `public.revoke_invitation` to `PUBLIC_AUTHENTICATED`)

Behavior implemented:
- `public.invite_member(p_institution_id, p_email, p_role, p_staff_id, p_guardian_id, p_student_id) returns table(invitation_id, token)`: caller gate `app.has_role(owner/principal/admin)` else `forbidden`; role validity check; `owner`-role invite needs owner caller, `principal`-role invite needs owner/principal (mirrors 0033); email lower-cased + regex check; exactly-one-link-per-role validation mirroring `app.validate_membership_link` (staff-class → `staff_id` only, `guardian` → `guardian_id` only, `student` → `student_id` only), linked row must belong to `p_institution_id` else `validation_failed`; link already active with that role → `conflict`; an open (unaccepted/unrevoked/unexpired) invitation for the same (institution, email, role) → `conflict`; token = 32 random bytes hex (`extensions.gen_random_bytes`), stored as sha256 hex (`extensions.digest`) via `token_hash`; expires in 7 days; audited as `core.invitation.created` with role only (no email) in metadata.
- `public.accept_invitation(p_token) returns uuid`: unauthenticated caller → `unauthenticated`; hash lookup → `not_found` if no row; accepted/revoked/expired → `invalid_state`; caller email (lower, from `auth.users`) must equal invitation email else `forbidden`; existing (institution, user, role) membership → `conflict`; inserts active membership under `app.allow_membership_bootstrap` GUC, **reset immediately after the insert** (hardening ruling, not left for transaction end); sets `user_id` on the linked staff/guardian/student row only when currently null (DBT-12); stamps `accepted_at`/`accepted_by`; audited as `core.invitation.accepted` (role only, no email).
- `public.revoke_invitation(p_invitation_id) returns void`: `not_found` if no row; same owner/principal/admin + role-escalation gate as invite (by the invitation's own role); only open invitations revocable else `invalid_state`; audited as `core.invitation.revoked`.
- All three: `security definer`, `set search_path = ''`, `execute` revoked from `public`/`anon`, granted to `authenticated` only.

Tests run:
- RED check: dropped the three functions, ran `pnpm test:db tests/db/invitation-rpc.test.ts` → 8/8 failed (PGRST202, function not found in schema cache) — confirms tests actually exercise the new RPCs.
- Recreated the functions from the migration file, ran again → `pnpm test:db tests/db/invitation-rpc.test.ts` → **8 passed (8)**.
- `pnpm test:security` → **1107 passed (18 files)**, including the updated grants list.
- `pnpm lint` → clean (no output, exit 0).
- `pnpm typecheck` → clean after fixing a test-helper type (see Assumptions).

Tests not run and why: none skipped; task scope covered by the above four commands.

Limitations / honesty label: no UI/action/route surface in this task (M03-T3..T6 wire it up); invitations carry no honesty badge requirement (not simulated/limited — rule 7 doesn't apply to a backend RPC).

Security / integration risks:
- Reviewed against BRIEF-COMMON lessons: definers use `search_path=''`, qualified `public.*`/`app.*`/`extensions.*` names, no dynamic SQL, `execute` revoked from `public`/`anon`; GUC bypass only inside `accept_invitation`, reset right after its own insert; no email/token in audit rows (metadata carries `role` only); `app.staff_roles()` reused for link-type classification rather than re-deriving it ad hoc.
- `invite_member`'s "link not already on an active membership with that role" check is scoped to the link id (e.g. `staff_id = p_staff_id and role = p_role`), not additionally re-filtered by `institution_id` — acceptable because `staff_id`/`guardian_id`/`student_id` are already proven to belong to `p_institution_id` earlier in the same function, so the id alone is unambiguous.
- `accept_invitation`'s `update ... set user_id = v_uid where id = ... and user_id is null` is a silent no-op if the linked row's `user_id` was already set by someone else between invite and accept — no error surfaced for that race; not in the brief's test list, flagging as a follow-up.

Follow-ups: none filed; the above race is the only observed gap and is low-probability (requires two invitations racing onto the same staff/guardian/student row).

New dependencies (justification): none.

Assumptions made:
- Token hashing: hashed the hex *token string* with `extensions.digest(text, 'sha256')` (not the raw pre-hex bytes) so `accept_invitation` can re-derive the same hash from the text it receives over PostgREST without a bytea round-trip; brief's "32 random bytes hex ... store sha256 hex" doesn't specify which form is hashed, this reading is internally consistent and verified by the "token is single-use" / basic-accept tests.
- `invite_member`'s own entry gate (`app.has_role(owner/principal/admin)`) is also the `unauthenticated` path (a null caller never has an active role) — brief states only "else forbidden" for this function, so no separate `unauthenticated` code was added here (unlike `accept_invitation`, which the brief explicitly says needs "caller not null").
- Fixed one pre-existing-pattern-adjacent TypeScript variance issue in the new test file only (a helper parameter typed as `ReturnType<typeof createSupabaseClient>` didn't unify with the generically-typed client from `supabase-js`); retyped it as `Awaited<ReturnType<typeof newSignedInUser>>["client"]`. Confined to the new test file, no other files touched for lint/typecheck.

---

## Fix round 1 (coordinator-requested hardening of `accept_invitation`)

Files changed (same two as above, no new files):
- `supabase/migrations/20261028000079_invitation_rpcs.sql` (edit — `accept_invitation` only; `invite_member`/`revoke_invitation` unchanged)
- `tests/db/invitation-rpc.test.ts` (edit — 2 new helpers + 3 new tests)

Three hardenings applied to `accept_invitation`:
1. **Row lock.** `select * into v_invitation from public.invitations where token_hash = v_token_hash for update` — a second concurrent `accept_invitation` call on the same token now blocks on the row lock until the first transaction commits, then re-reads the now-`accepted_at`-set row and hits the existing `invalid_state` check, instead of racing the first call's insert.
2. **Linked-record ownership check.** Before the membership insert, looks up the linked staff/guardians/students row's current `user_id`. If it's set and not the caller → `raise exception 'code:conflict' using detail = 'linked record belongs to another account'`. Only when it's null (or already the caller's own) does the function proceed to insert the membership and backfill `user_id` as before.
3. **`unique_violation` → `conflict`.** The membership insert is now wrapped in its own `begin...exception when unique_violation then raise exception 'code:conflict'...end` block (same shape as `create_institution`'s slug-conflict handling in 0064), so a duplicate `(institution_id, user_id, role)` racing past the pre-insert `exists()` check surfaces as `conflict`, not an unmapped `internal` error.

Tests added (`tests/db/invitation-rpc.test.ts`):
- `"concurrent accept_invitation calls on the same token serialise (only one membership is created)"` — `Promise.all` of two `accept_invitation` calls with the same token; asserts exactly one success, one `code:invalid_state`, and exactly one membership row. Exercises hardening 1.
- `"linked record already belonging to another account → conflict"` — invites a teacher email onto a staff row whose `user_id` is already a different, unrelated user; asserts `code:conflict` on accept. Exercises hardening 2 (the fix-request's priority case).
- `"concurrent accept of two invitations for the same role maps the duplicate to conflict"` — directly seeds two separate open invitations (distinct tokens, distinct staff rows, same institution/email/role) via a new `insertInvitationDirect` test helper (bypasses `invite_member`'s own duplicate-open-invitation check, which would otherwise block a normal double-invite), then `Promise.all`s both accepts; asserts exactly one success, one `code:conflict`, and exactly one membership row. Exercises hardening 3 — though whether the losing request is rejected by the pre-insert `exists()` check or by the new `unique_violation` handler depends on exact transaction timing; both paths yield the same observable `code:conflict`, which is what the test (and the fix request) actually requires.

RED/GREEN:
- RED: dropped `public.accept_invitation` only, ran `pnpm test:db tests/db/invitation-rpc.test.ts -t "serialise|another account|maps the duplicate"` → all 3 new tests failed (PGRST202, function not found) — confirms they exercise the new code.
- Recreated all three functions from the edited migration file (direct `psql < migration file`, same local-reapply approach as the original RED/GREEN), ran the full file → `pnpm test:db tests/db/invitation-rpc.test.ts` → **11 passed (11)**. Re-ran 3× in a row to check for flakiness in the two concurrency tests — stable at 11/11 each time.
- `pnpm lint` → clean.
- `pnpm typecheck` → clean, no changes needed this round.
- `pnpm test:security` → re-ran, still **1107 passed (18 files)** (no grants/RLS surface changed by this fix round).

Limitations: the two `Promise.all` concurrency tests depend on the local Postgres/PostgREST stack actually interleaving two near-simultaneous requests; verified stable across 3 local runs, but is not a formal guarantee the way a single-connection `BEGIN`/lock-wait test would be — flagging in case CI timing differs from local.

Security / integration risk: none new; hardening 2's institution-scoped linked-row check reads a column (`staff.user_id`/`guardians.user_id`/`students.user_id`) already provable from the invitation row's own `staff_id`/`guardian_id`/`student_id`, each already proven to belong to the invitation's own institution by `invite_member` at invite time.

Follow-ups: none outstanding — this closes the follow-up flagged in the original report ("silent no-op" is now a `conflict`, not silent).
