### Task 5: M05-T5 Acceptance over HTTP + storage-level checks
READ: BRIEF-COMMON.md; M04 acceptance test (HTTP pattern)
FILES: `tests/db/documents-acceptance.test.ts` (new)
TEST: via `/api/v1/actions/*` with bearer tokens on a fixture school: admin uploads a PDF for student A and a PNG for staff member T → guardian of A reads A's PDF (bytes match); guardian of B → 404; teacher T reads own staff doc, not A's; direct storage calls with the guardian's own client: `download(pathOfB)` fails, `upload` to an arbitrary `<institution>/student/...` path fails (no pending row); bucket rejects an 11 MB object and an `application/x-msdownload` object even with a valid signed upload token.
ACCEPT: `pnpm test:db tests/db/documents-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Opus after T5: `07 §4` note (no service role; storage delegated to documents RLS); tracker; security review on the diff; full gate; `supabase db push --linked` to hosted (owner approved pushing migrations, 2026-11-01); commit/push; `DONE M05 <sha>`.
