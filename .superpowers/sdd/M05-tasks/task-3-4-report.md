# M05 T3/T4 report

## Files
- `src/modules/documents/schemas.ts` (new) — RequestUploadSchema, ConfirmUploadSchema, GetReadUrlSchema, DeleteDocumentSchema, ListForEntitySchema; relative `.ts` imports.
- `src/modules/documents/actions.ts` (new) — `requestUpload` (`document.requestUpload`, `document.write`), `confirmUpload` (`document.confirmUpload`, `document.write`), `getReadUrl` (`document.getReadUrl`, `document.read`), `deleteDocument` (`document.delete`, `document.write`). All storage calls use the caller's own `createClient()` — no service role.
- `src/modules/documents/queries.ts` (new) — `listDocumentsForEntity` (metadata only: id, kind, fileName, mime, sizeBytes, createdAt — no path/url).
- `src/modules/documents/query-defs.ts` (new) — `documents.listForEntity` (`document.read`).
- `src/app/api/v1/actions/all-actions.ts`, `src/app/api/v1/query/all-queries.ts` — manifest lines.
- `tests/security/escalation.test.ts` — 4 fixtures (requestUpload, confirmUpload, getReadUrl, delete).
- `tests/db/api-query-route.test.ts` — sample input for `documents.listForEntity` in the owner smoke map.
- `tests/db/documents-upload-actions.test.ts` (new, T3, 6 tests).
- `tests/db/documents-read-actions.test.ts` (new, T4, 5 tests).

## Behavior
- `requestUpload`: verifies the entity is visible in the caller's institution via RLS select (students/staff/applications); `submission` → `validation_failed` (no reader until M9). Generates `document_id` with `crypto.randomUUID()`, builds `path` server-side, inserts the `pending` row, calls `createSignedUploadUrl`, audits `document.upload_requested` (ids only).
- `confirmUpload`: row must be `pending` else `invalid_state`; checks the object exists via `storage.list(dir, {search: name})` with the caller's client; sets `active`; audits `document.upload_confirmed`.
- `getReadUrl`: row must be visible + `active` else `not_found`; `createSignedUrl(path, 60)`; audits `document.read_url`; returns `{ url, expiresIn: 60, fileName, mime }`.
- `deleteDocument`: soft delete (`status='deleted'`, `deleted_at`, `deleted_by`); audits `document.delete`.
- `documents.listForEntity`: thin `defineQuery` wrapper over `listDocumentsForEntity`.

## Blocker found and controller-fixed mid-task
`confirmUpload`'s existence check needs to SELECT the just-uploaded object from `storage.objects` with the caller's own client, but migration 0067's original `tenant_docs_select` policy only allowed `status = 'active'` — a chicken-and-egg problem (can't verify existence before flipping active, can't flip active without verifying). The controller patched `tenant_docs_select` in `supabase/migrations/20261028000067_documents.sql` (already applied to local DB) to also allow `status = 'pending' and created_by = caller`. No workaround was added on my side before or after the fix — `objectExistsInStorage` always used the caller's own client and `storage.list()`.

## Other fix during TDD
Audit action strings must match `record_audit_event`'s `^[a-z_]+(\.[a-z_]+)+$` check (dotted lowercase, underscores only). Initial `confirmUpload` audit string `document.confirmUpload` (camelCase) failed with `validation_failed`; renamed the **audit** string (not the action/permission name) to `document.upload_confirmed`.

## Tests run
- `pnpm test:db tests/db/documents-upload-actions.test.ts` → 6 passed
- `pnpm test:db tests/db/documents-read-actions.test.ts` → 5 passed
- `pnpm test:db tests/db/documents-rls.test.ts` → 7 passed (regression check after the migration patch)
- `pnpm test:db tests/db/api-query-route.test.ts` → 7 passed (smoke map includes `documents.listForEntity`)
- `pnpm test tests/unit/action-names-unique.test.ts` → 4 passed
- `pnpm test:security tests/security/escalation.test.ts` → 612 passed
- `pnpm lint` → clean
- `pnpm typecheck` → clean

## Limitations / honesty label
No UI; not user-facing, no honesty badge applies. `documents-acceptance.test.ts` (T5, HTTP-level) is being written in parallel by another agent — not touched.

## Security / integration risks
None identified beyond the documents_select/storage RLS composition already reviewed in the migration's own comments. The storage SELECT policy now also trusts `created_by = app.current_user_id()` for pending rows — same actor check already used by the INSERT policy, so no new exposure (an uploader can list/exists-check only their own still-pending object, never another's).

## Follow-ups
None for T3/T4. T5 (HTTP acceptance) and the Opus end-of-M05 steps (07 §4 note, hosted push, commit) are out of scope here.

## New dependencies
None.

## Assumptions made
- Audit action string for `confirmUpload` left as `document.upload_confirmed` (brief said "audit" without naming the string, unlike `document.upload_requested`/`document.read_url` which were named explicitly).
- `deleteDocument`'s audit action string is `document.delete` (same as the action name — already dotted-lowercase, brief gave no other string).
