# M02 query registry — security review

Scope: 68 `defineQuery` wrappers under `src/modules/*/query-defs.ts`, dispatch
refactor in `src/lib/http/dispatch.ts`, routes in `src/app/api/v1/query/**`.
Read-only review, no code changed.

## Findings

src/modules/academics/query-defs.ts:65: HIGH: `academics.listTeachableSections`
uses `permission: "academics.read"`, but the comment directly above it (lines
57-64) concludes the correct floor is `ai.generate` (assignment.read and
assignment.manage both fail the admissions-role caller). academics.read is
held by every role including student and guardian (src/lib/auth/permissions.ts),
so this grants accountant/exam_controller/student/guardian direct API access
to a staff section-roster query that was never reachable from any page they
can see — implementation contradicts its own documented analysis. Fix: change
`permission` to `"ai.generate"` to match the comment, or correct the comment
if academics.read was intentionally chosen and document why it's safe for
student/guardian.

src/modules/academics/query-defs.ts:77: HIGH: same bug, same cause, in
`academics.listSectionSubjects` (comment again derives `ai.generate`, code
uses `"academics.read"`). Same fix.

src/modules/finance/query-defs.ts:62-67: MEDIUM: `finance.listFeeStructures`
uses `permission: "student.read"`. The comment's own reasoning only needed
the union of `finance.structure.manage` and `admissions.enquiry.read`
(owner/principal/admin/accountant/admissions). `student.read` is held by
*every* role (incl. teacher, exam_controller, student, guardian per
src/lib/auth/permissions.ts), so the gate is far looser than the union it was
chosen to cover — this is the exact "permission gate looser than domain key"
pattern. Fee-structure amounts become directly fetchable by every
student/guardian/teacher via the API even though no page exposes this to
them. Fix: use a permission function that checks for either
`finance.structure.manage` or `admissions.enquiry.read` (defineQuery already
supports `permission: (input) => Permission`, but that only returns one
permission — simplest fix is a dedicated narrower permission or an inline
check inside the handler before falling back to RLS).

src/app/api/v1/query/[name]/route.ts:26-45 (GET handler): LOW/INFO: by design
GET carries no Origin/CSRF check (reasoned in the code comment: no body, so
nothing new to protect against vs. a plain top-level navigation). Confirmed
by inspection of all 68 registered handlers that none have side effects
(notifications.markRead is not registered; only listMyNotifications /
unreadCount / listDeliveryLog are). Residual risk is sensitive identifiers
(studentId, examId, free-text search terms) and institution slugs appearing
in URLs — logged in browser history, server/proxy access logs, and any
`Referer` header sent onward. Not a code defect, but worth a conscious
decision: either accept it (read-only JSON, no exfil path without XSS/CORS
elsewhere) or restrict GET to a documented allowlist of non-sensitive
queries.

## Checked, no issue found

- `src/lib/http/dispatch.ts` vs the pre-refactor M01 routes (via
  `.superpowers/sdd/M02-tasks/m02-diff.patch`): `dispatchCall`/`readPostBody`/
  `listResponse` are a verbatim extraction — Origin check still runs before
  body parsing, body-size cap unchanged (1 MB), slug validation order
  unchanged, bearer-token handling unchanged, `controlFlowStatus` 401/404
  mapping unchanged, correlation-id/500 fallback unchanged. No behavioral
  regression found.
- Service-role / RLS bypass: grepped all `queries.ts` files under
  `src/modules/*` plus `src/modules/ai/*` for `supabaseAdmin` /
  `withAiServiceRole` / `service_role` / `.rpc(`. Only
  `src/modules/website/queries.ts:61` calls a `security definer` RPC
  (`get_public_site`), and it is not one of the M02-registered queries
  (website.getWebsite uses the normal editor-scoped `getWebsite` function,
  gated on `website.edit`). No query handler in the registry relies on a
  service-role/definer bypass guarded only by the `defineQuery` permission
  check.
- Input schemas: every id-shaped field uses `uuid` from
  `src/lib/schemas/common.ts` (`z.string().uuid()`), not bare strings.
  Numeric limit/page fields are either capped in the schema
  (`notifications.listMyNotifications` max 200, `listDeliveryLog` max 500) or
  clamped server-side regardless of input (`finance.listLedgerEntries` via
  `MAX_LEDGER_PAGE_SIZE`/`Math.min`, `people.listStudents` via fixed
  `PAGE_SIZE` + range offset). No unbounded-limit query found.
- All `defineQuery` calls use static `permission` strings (no
  `permission: (input) => ...` narrowing anywhere in the 68), so
  `getQueryMeta`'s listing endpoint reports every query's real permission
  — nothing hidden behind a function the listing can't introspect.
- `apiResponse` sets `cache-control: no-store` on every response (including
  the new query GET routes), so no shared/proxy caching of per-user query
  results.
- BOLA-style id params (`studentId`, `examId`, etc. passed cross-entity, e.g.
  `finance.listInvoicesForStudent`, `academics.listStudentAssignments`) are
  pre-existing handler functions reused verbatim from the pre-M02 action/page
  code path; each relies on RLS to scope the id to the caller's own
  student/child, consistent with the repo-wide convention stated in their own
  comments. Not a new risk introduced by this diff — flagging only for the
  record, not as a new finding.

## Counts

CRITICAL: 0, HIGH: 2, MEDIUM: 1, LOW: 1
