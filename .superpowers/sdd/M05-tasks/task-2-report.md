Packet: T-0M05-T2 Migration 0067 — documents table, RLS, bucket, storage policies

Files changed:
- `supabase/migrations/20261028000067_documents.sql` (new)
- `tests/db/documents-rls.test.ts` (new)
- `tests/security/rls-expectations.ts` (added `documents` entry — C-01 requires every `institution_id` table registered)
- `src/lib/db/types.ts` (raw `pnpm db:types` regen, additions only)

Behavior implemented:
- `public.documents`: columns/checks/index exactly as brief (entity_type, kind 1-60, file_name 1-200, mime in 3 allowed, size_bytes 1-10485760, path unique, status pending/active/deleted, created_by not null, deleted_at/deleted_by).
- `app.guard_documents_update` (BEFORE UPDATE, security invoker, service_role/postgres bypass per lesson 5): institution_id/entity_type/entity_id/path/created_by/mime immutable; status only pending→active, active→deleted.
- RLS SELECT: owner/principal/admin all rows (`app.my_institution_ids`); admissions student/application rows; any member sees a staff doc whose `staff.user_id` is their own; guardian/student see `app.my_student_ids()` student docs; submission has no reader yet (only the admin branch reaches it) — matches 07 §2.2/ruling.
- RLS INSERT/UPDATE: owner/principal/admin any type; admissions student/application only; `entity_id` bound to same `institution_id` via the real owning table (students/staff/applications) — lesson 2. `submission` has no backing table yet (M9), so no entity_id cross-check for it; only owner/principal/admin can insert that type anyway.
- Bucket `tenant-docs` (private, 10MB, 3 mime types), `on conflict do nothing`.
- `storage.objects` policies `tenant_docs_select`/`tenant_docs_insert`: delegate entirely to a plain (non-definer) `exists` against `public.documents` — visibility falls out of `documents_select`'s own RLS composition, no separate helper, no service role (matches ruling exactly).

New SECURITY DEFINER functions: none. `app.guard_documents_update` is a plain trigger function (no `security definer`), language plpgsql, no table access inside — not subject to DBT-45 inlining (that trap is specific to `language sql` functions the planner can inline into a policy).

Tests run:
- `pnpm test:db tests/db/documents-rls.test.ts` → RED (table didn't exist) → applied migration → GREEN, 7/7 passed (guardian own-child-only, student own-only, teacher own-staff-doc-only, admissions blocked from staff doc, admin-A blocked from B's student, path immutable, deleted readable but can't revive).
- `pnpm test:security` → 18 files, 1285 passed. No existing expectation needed changing beyond adding the new `documents` entry.
- `pnpm lint` / `pnpm typecheck` → clean.

Tests not run and why: no storage-upload-level test (real file PUT against `tenant-docs`) — not in the brief's TEST FIRST list, which is documents-row-level only; storage policy is a thin delegation to the already-tested `documents_select`/`documents_insert` logic, so a redundant storage-layer test would just re-prove the same RLS.

Limitations / honesty label: n/a (no UI, no simulated/limited channel here).

Security / integration risks:
- `entity_id` is a polymorphic FK with no real foreign key constraint (can't be, the referenced table varies by `entity_type`); institution-scoping relies entirely on the INSERT/UPDATE `with check` exists-subqueries, not a DB-level constraint. A direct `service_role` write (seed/jobs only, per repo rules) bypasses this — same shape as every other polymorphic/role-gated table in this schema, not a new risk class.
- `submission` entity_type is accepted by the check constraint today but has no owning table until M9; a future bug there would currently insert with no institution-scope validation for that one type (owner/principal/admin only, so blast radius is already role-gated).

Follow-ups: none filed — M05-T3 (per the task order T1→T5) is the consumer (document upload/read_url actions + `document.read_url` audit) and will exercise the storage policies end-to-end.

New dependencies (justification): none.

Assumptions made:
- Test fixtures (`tests/helpers/roles.ts`) never set `staff.user_id`; the "own staff doc" test sets it directly via SQL for the teacher fixture, matching the ruling's literal `staff.user_id = auth uid` check — this is the realistic app behavior once a staff member accepts an invite and gets `user_id` populated (M03), not a test-only shortcut.
- No explicit `grant ... on table public.documents to authenticated` statement added, following the current precedent (0064 invitations, 0066 imports) that local/hosted default privileges now cover new tables (DBT-39 resolved per recent commit `7e260e7`) — confirmed working since `pnpm test:security`'s grants suite passed with no documents-specific failure.
