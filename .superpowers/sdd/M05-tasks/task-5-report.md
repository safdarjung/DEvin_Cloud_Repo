# M05-T5 report — documents acceptance (HTTP + storage)

File: `tests/db/documents-acceptance.test.ts` (new, no source files touched).

## Status: RED — blocked on a bug in `src/modules/documents/actions.ts` (T3/T4, in progress)

Single test, one fixture school (`createTestInstitution`), matching the brief's scenario:
admin uploads a PDF for student A (fixture student, linked to fixture guardian via a new
`guardian_students` row) and a PNG for staff member T (fixture teacher, `staff.user_id` set
to the teacher's auth id); a second student B + a second real guardian user (created inline,
service-role `auth.admin.createUser`, not in `roles.ts`) prove guardian scoping rather than
just tenant scoping.

Covers every case in the T5 brief:
1. admin `document.requestUpload` + `uploadToSignedUrl` + `document.confirmUpload` for A (pdf) and T (png)
2. guardian(A) `document.getReadUrl` → 200, fetched bytes equal uploaded bytes
3. guardian(B) `document.getReadUrl` on A's doc → 404 `not_found`
4. teacher `document.getReadUrl` on own staff doc → 200, bytes match; on A's doc → 404 `not_found`
5. guardian(A)'s own client: `storage.download(pathOfB)` fails; direct `storage.upload()` to an
   arbitrary student path (no pending row) fails
6. bucket-level: request a valid small-pdf upload, then actually push an 11 MB buffer through
   that signed token → upload fails; same with a fresh token but `application/x-msdownload`
   content-type → upload fails

Cleanup: `admin.storage.from("tenant-docs").remove(paths)` for every path a signed upload was
requested for, `admin.auth.admin.deleteUser(guardianBId)`, then `inst.cleanup()`.

## Failing case (RED)

`document.confirmUpload` returns `409 invalid_state` ("No uploaded object found for this
document") right after a real, successful `uploadToSignedUrl` (its own `error` is `null`).

Root cause, read in `src/modules/documents/actions.ts`: `confirmUpload` checks object
existence with `objectExistsInStorage()`, which calls `supabase.storage.from(BUCKET).list(dir, { search: name })`
using the **caller's own client** — exactly per the T3 brief. But `list()` is a SELECT against
`storage.objects`, gated by migration 0067's `tenant_docs_select` policy, which only matches
when `exists (… d.status = 'active' …)`. At the moment `confirmUpload` runs, the row is still
`pending` (that's the whole point of confirm — it's what flips it to `active`). So the
caller can never see their own just-uploaded object via `list()` before the row is active,
and the row can never become active because the existence check fails first. This is a
chicken-and-egg bug in the T3 implementation, not a test bug — every later assertion in the
test is unreachable until it's fixed.

Not a schemas/permissions issue: `document.read`/`document.write` (T1/T2) are already landed
and correct for this flow.

## Commands run

- `pnpm test:db tests/db/documents-acceptance.test.ts` → 1 failed (above)
- `pnpm lint tests/db/documents-acceptance.test.ts` → clean
- `pnpm typecheck` → clean (repo-wide; no errors in any file, including the other agent's)

## Concerns / follow-up for the T3/T4 owner

`confirmUpload`'s existence check needs a path that doesn't depend on `tenant_docs_select`.
Options: service-role check is ruled out by the M05 header ("no service role anywhere"); an
INSERT-policy-shaped check (e.g. attempt a zero-byte `upload()` to the same path with
`upsert: true` and treat a storage error as "not uploaded yet") or checking `storage.objects`
metadata some other RLS-reachable way would need the `tenant_docs_insert`/`tenant_docs_select`
policies revisited. Flagging for Opus's post-T5 security review rather than fixing it myself
(out of scope per task packet — no source edits).
