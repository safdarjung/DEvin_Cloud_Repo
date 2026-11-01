### Task 4: M05-T4 `document.getReadUrl`, `document.delete`, `documents.listForEntity`
READ: BRIEF-COMMON.md; Task 3 files
FILES: `src/modules/documents/actions.ts` (edit); `src/modules/documents/queries.ts` + `query-defs.ts` (new); `tests/db/documents-read-actions.test.ts` (new); + manifest/all-queries lines + 2 escalation fixtures
EXPORTS: `getReadUrl` = `document.getReadUrl` {documentId} (`document.read`): row must be visible + `active` (else not_found), `createSignedUrl(path, 60)` with the caller's client → `{ url, expiresIn: 60, fileName, mime }`; audit `document.read_url`. `deleteDocument` = `document.delete` {documentId} (`document.write`): soft delete, audit. `listDocumentsForEntity(ctx, entityType, entityId)` → active rows' metadata (no paths, no URLs); query `documents.listForEntity` (`document.read`).
TEST FIRST: guardian gets a URL for own child's doc and the URL downloads the bytes; guardian of another child → not_found; deleted doc → not_found and storage refuses a fresh signed URL; list returns metadata only; accountant reading a student doc → not_found (RLS), not forbidden.
ACCEPT: `pnpm test:db tests/db/documents-read-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`

