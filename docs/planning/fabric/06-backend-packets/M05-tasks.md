# M05 — Documents / storage

Source: `07-master-plan-v1-v2.md` §3 M5. Migration `0067` (claimed). No new deps. New owning module `src/modules/documents` (owns `documents`).

Rulings (recorded in the ledger):
- **Object access is delegated to `documents` RLS.** Bucket `tenant-docs` is private. `storage.objects` policies only say: SELECT an object when a visible `documents` row with that `path` is `active`; INSERT an object when a visible `documents` row with that `path` is `pending` and `created_by` = caller. No UPDATE/DELETE policies. Who may see which document is decided once, in `documents` RLS. No service role anywhere.
- Bucket created by the migration (`insert into storage.buckets … on conflict do nothing`) with `file_size_limit = 10485760` and `allowed_mime_types = {application/pdf, image/jpeg, image/png}` so local and hosted match; `supabase/config.toml` is not touched.
- Path `<institution_id>/<entity_type>/<entity_id>/<document_id>.<ext>`, built server-side only.
- Permissions: `document.read` = all 9 roles (RLS scopes it); `document.write` = owner, principal, admin, admissions.
- `documents` RLS SELECT (07 §2.2): owner/principal/admin — all; admissions — `student`, `application`; any member — `staff` docs whose staff row is their own (`staff.user_id = auth uid`); guardian/student — `student` docs of `app.my_student_ids()`; `submission` — no reader until M9. INSERT/UPDATE: owner/principal/admin any type; admissions `student`/`application` only; `entity_id` must belong to the same institution (lesson 2); `created_by` = caller on insert. Use initPlan helpers (`(select app.my_student_ids())`, `app.my_institution_ids(...)`), never per-row definers (lesson 7).
- Soft delete: `status = 'deleted'` (+ `deleted_at`, `deleted_by`); object kept, unreadable because the storage policy needs `active`.
- Reading a document is audited (`document.read_url`), so the signed-URL call is an action, not a query.

Every new action: import in `src/app/api/v1/actions/all-actions.ts` + C-03 fixture in `tests/security/escalation.test.ts`. Every new query: `src/modules/documents/query-defs.ts` + `all-queries.ts`. Seed-imported files: relative `.ts` imports only.

Order: T1 → T2 → T3 → T4 → T5.

---

### Task 1: M05-T1 Permissions `document.read`, `document.write`
READ: BRIEF-COMMON.md; `src/lib/auth/permissions.ts`; `tests/unit/permissions.test.ts`; `07-security-and-ai-governance.md` §2.2
FILES: `src/lib/auth/permissions.ts`; `tests/unit/permissions.test.ts`; `docs/planning/coolskool/07-security-and-ai-governance.md` (two matrix rows)
EXPORTS: `"document.read"` in all 9 role lists; `"document.write"` in owner, principal, admin, admissions.
TEST FIRST: holders of each key exactly as above.
ACCEPT: `pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 2: M05-T2 Migration 0067 — documents table, RLS, bucket, storage policies
READ: BRIEF-COMMON.md (lessons 1, 2, 7, DBT-45 note); rulings above; `supabase/migrations/20261028000020*.sql` (initPlan helpers), `…0066_imports.sql` (style)
FILES: `supabase/migrations/20261028000067_documents.sql` (new); `tests/db/documents-rls.test.ts` (new); `src/lib/db/types.ts` (regen)
EXPORTS: `public.documents` (id, institution_id → institutions, entity_type text check in ('student','staff','application','submission'), entity_id uuid not null, kind text check length 1–60, file_name text check length 1–200, mime text check in the 3 allowed, size_bytes int check 1–10485760, path text not null unique, status text default 'pending' check in ('pending','active','deleted'), created_by → profiles not null, deleted_at, deleted_by → profiles, created_at, updated_at; index (institution_id, entity_type, entity_id)); `set_updated_at`; RLS per rulings; a BEFORE UPDATE guard trigger (security invoker) so `institution_id, entity_type, entity_id, path, created_by, mime` never change and status only moves pending→active, active→deleted; bucket row; `storage.objects` policies `tenant_docs_select` / `tenant_docs_insert` per rulings (table-qualify `storage.objects.name`).
TEST FIRST (SQL-level with role clients): guardian sees own child's document row, not another child's; student sees own; teacher sees own staff doc only; admissions cannot insert a `staff` document; admin of A cannot insert a doc whose `entity_id` is B's student; `path` cannot be updated; deleted row stays readable to admin but status can't go back to active.
ACCEPT: `pnpm test:db tests/db/documents-rls.test.ts`; `pnpm test:security` (update RLS/grants expectations if required — say so); `pnpm lint`; `pnpm typecheck`

### Task 3: M05-T3 `document.requestUpload` + `document.confirmUpload`
READ: BRIEF-COMMON.md; rulings; `src/modules/imports/actions.ts` (style); installed `@supabase/storage-js` d.ts (`createSignedUploadUrl`, `uploadToSignedUrl`, `list`/`exists`)
FILES: `src/modules/documents/schemas.ts` (new, relative `.ts` imports); `src/modules/documents/actions.ts` (new, `"use server"`); `tests/db/documents-upload-actions.test.ts` (new); + manifest line + 2 escalation fixtures
EXPORTS: `RequestUploadSchema` {entityType, entityId, kind, fileName, mime (allowlist), sizeBytes ≤ 10485760}; `requestUpload` = `document.requestUpload` (`document.write`): verify the entity is visible in the caller's institution (RLS select on students/staff/applications; submission → `validation_failed` until M9), insert the `pending` row (id generated server-side, path per rulings), `createSignedUploadUrl(path)` with the caller's client → `{ documentId, path, token, signedUrl }`; audit `document.upload_requested` (ids only). `confirmUpload` = `document.confirmUpload` {documentId} (`document.write`): object must exist in storage (caller's client) else `invalid_state`; set `active`; audit.
TEST FIRST: admin requests + uploads a small PDF via `uploadToSignedUrl` + confirms → row active; teacher → forbidden; `text/plain` → validation_failed; 11 MB declared → validation_failed; confirm before upload → invalid_state; entity from another institution → not_found.
ACCEPT: `pnpm test:db tests/db/documents-upload-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 4: M05-T4 `document.getReadUrl`, `document.delete`, `documents.listForEntity`
READ: BRIEF-COMMON.md; Task 3 files
FILES: `src/modules/documents/actions.ts` (edit); `src/modules/documents/queries.ts` + `query-defs.ts` (new); `tests/db/documents-read-actions.test.ts` (new); + manifest/all-queries lines + 2 escalation fixtures
EXPORTS: `getReadUrl` = `document.getReadUrl` {documentId} (`document.read`): row must be visible + `active` (else not_found), `createSignedUrl(path, 60)` with the caller's client → `{ url, expiresIn: 60, fileName, mime }`; audit `document.read_url`. `deleteDocument` = `document.delete` {documentId} (`document.write`): soft delete, audit. `listDocumentsForEntity(ctx, entityType, entityId)` → active rows' metadata (no paths, no URLs); query `documents.listForEntity` (`document.read`).
TEST FIRST: guardian gets a URL for own child's doc and the URL downloads the bytes; guardian of another child → not_found; deleted doc → not_found and storage refuses a fresh signed URL; list returns metadata only; accountant reading a student doc → not_found (RLS), not forbidden.
ACCEPT: `pnpm test:db tests/db/documents-read-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 5: M05-T5 Acceptance over HTTP + storage-level checks
READ: BRIEF-COMMON.md; M04 acceptance test (HTTP pattern)
FILES: `tests/db/documents-acceptance.test.ts` (new)
TEST: via `/api/v1/actions/*` with bearer tokens on a fixture school: admin uploads a PDF for student A and a PNG for staff member T → guardian of A reads A's PDF (bytes match); guardian of B → 404; teacher T reads own staff doc, not A's; direct storage calls with the guardian's own client: `download(pathOfB)` fails, `upload` to an arbitrary `<institution>/student/...` path fails (no pending row); bucket rejects an 11 MB object and an `application/x-msdownload` object even with a valid signed upload token.
ACCEPT: `pnpm test:db tests/db/documents-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Opus after T5: `07 §4` note (no service role; storage delegated to documents RLS); tracker; security review on the diff; full gate; `supabase db push --linked` to hosted (owner approved pushing migrations, 2026-11-01); commit/push; `DONE M05 <sha>`.
