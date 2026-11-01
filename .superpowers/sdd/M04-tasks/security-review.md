# M04 CSV import/export — security review

Scope: migration 0066, `src/modules/imports/{actions,queries,query-defs,schemas}.ts`,
`src/lib/http/csv.ts`, `src/app/api/v1/query/[name]/route.ts`, `data.import` permission.
Read-only review against `.superpowers/sdd/M04-tasks/m04-diff.patch`.

## Findings

supabase/migrations/20261028000066_imports.sql:720-756: LOW: `import_batches_update` RLS
checks only role, not which columns change — an owner/principal/admin can PATCH their
own institution's `import_batches` row directly over PostgREST (status, committed_count,
skipped_count, committed_by, committed_at) without ever calling `commit_import_batch`,
forging a "committed" state with no entities actually created, or misattributing
`committed_by` to a different profile id (no check that it equals the caller). Fix:
restrict the update policy to the columns the app actually needs to patch directly (if
any — today none; the app never calls `.update()` on this table), or add a trigger that
rejects status/count/committed_* changes outside `commit_import_batch`.

src/modules/imports/actions.ts:335-361: MEDIUM: `stageImport` is not atomic. The batch
insert and the `CHUNK_SIZE`-batched row inserts are separate network calls with no
surrounding DB transaction; if a later chunk's insert fails, `throwMapped` aborts the
action but the batch row and earlier chunks already committed to Postgres remain,
leaving an `import_batches` row whose `row_count`/`valid_count`/`error_count` overstate
what is actually in `import_rows`. Nothing stops `commit_import_batch` from later being
called on that partial batch, silently importing a truncated subset with no error
surfaced to the caller. Fix: move stage into a single `security invoker` RPC (same
shape as `commit_import_batch`) so insert of batch + all rows is one transaction, or
validate row counts before allowing commit.

src/modules/imports/schemas.ts:503-508,640: LOW: `MAX_CSV_BYTES` (1,048,576 chars) on
the `csv` field is effectively dead validation — `dispatchCall`'s `MAX_BODY_BYTES`
(`src/lib/http/dispatch.ts:11`, 1,000,000 bytes) caps the whole JSON request body
(institution + fileName + JSON-escaped csv string) first, so the schema's own limit can
never be the one that fires, and a CSV with many multi-byte (non-ASCII, e.g. Indian-
language guardian names) characters hits the byte cap well before the char cap. Not
exploitable (the outer cap still bounds request size), just a misleading constant name
and dead code path. Fix: drop the redundant `.max()` or document that the dispatcher's
byte cap is the real bound.

src/modules/imports/actions.ts:335-348 / supabase/migrations/20261028000066_imports.sql
(guardian/student insert path), console.error in src/lib/actions/result.ts:92: LOW:
Postgres constraint-violation details for `import_rows`/`import_batches` inserts (e.g.
"Key (batch_id, row_no)=(...) already exists") are logged server-side via
`console.error` when `mapSqlError` doesn't recognize a `code:` prefix; the raw Postgres
error object (not the row's `data` JSON itself, but potentially some of its scalar
values depending on which constraint fired) can end up in server logs. No client-facing
leak (confirmed: `mapSqlError` only returns `detail` when the message matches
`^code:[a-z_]+$`, otherwise a generic `internal` + correlation id). Note for log
pipeline hygiene given guardian phone/email pass through this path; no code change
required unless the log sink is not access-controlled.

src/app/api/v1/query/[name]/route.ts:28-54, src/lib/http/dispatch.ts (readPostBody vs
GET): LOW / informational: the `GET` query route (and therefore `?format=csv`) has no
`isCrossSiteRequest` origin check, unlike the POST path — justified in-code for body
tampering, but combined with `Content-Disposition: attachment` this allows a top-level
cross-site navigation (SameSite=Lax cookies still ride along on top-level GET nav) to
trigger a CSV download using the victim's own session. Impact is limited to the victim
downloading their own authorized data to their own machine (no read access for the
attacker page, no privilege escalation) — pre-existing design for all `/api/v1/query/*`
GET endpoints, not introduced by M04. Flagging because CSV's `attachment` header is the
part that makes a silent download plausible; no fix required unless the project wants a
stronger cross-site read defense across all query GET routes (out of scope for M04).

## Checked, no finding (named risks that turned out mitigated)

- **Definer helpers reachable outside the commit**: `app.lock_import_batch`,
  `app.audit_import_commit`, `app.import_insert_guardian_student` live in schema `app`,
  which is NOT in `supabase/config.toml`'s exposed `[api].schemas` (`public`, `storage`,
  `graphql_public`). PostgREST cannot call them directly regardless of the `grant
  execute ... to authenticated` statements; they're only reachable via SQL from
  `public.commit_import_batch`'s own body. No other `public` function calls them.
- **`app.import_insert_guardian_student` linking a guardian/student the caller couldn't
  otherwise link**: it re-checks `has_role(p_institution_id, owner/principal/admin)` and
  that both FKs belong to `p_institution_id` — narrower than (never wider than) the real
  `guardian_students_insert` RLS policy's `owner/principal/admin/admissions`, so it
  grants nothing a caller with `data.import` couldn't already do through normal CRUD on
  `guardian_students`.
- **Crafted `import_rows.data` (cross-tenant ids, wrong types) committed via the
  invoker RPC**: `commit_import_batch` is `security invoker`, so every row write inside
  it (`students`, `enrolments`, `staff`) still runs under the caller's own RLS. The
  write-side FK-binding policies added in migrations 0036 (`enrolments_insert`) and 0065
  (`staff_insert`) already reject a `class_section_id`/`academic_year_id`/`department_id`
  that doesn't belong to the row's own `institution_id` — a crafted cross-tenant id in
  `data` causes the per-row RLS violation to be caught by the function's `exception when
  others` block and the row is marked `invalid` with a generic message, not applied.
  Verified against `students_insert`/`guardian_students_insert` role sets too — `owner/
  principal/admin` (what `data.import` requires) is a subset of every policy's allowed
  role set, so no escalation there either.
- **`import_rows_insert`/`update` institution/batch binding**: policy requires
  `import_batches.institution_id = import_rows.institution_id` for the same `batch_id`
  (0036/0065-style binding) — confirmed present (lines 737-756).
- **PII in `imports.getBatch`**: `getImportBatch` (`src/modules/imports/queries.ts`)
  explicitly selects only `row_no, errors` from `import_rows`, never `data` (which holds
  guardian phone/email). CSV export of that query's shape only ever surfaces
  `invalidRows` (the sole array field), so `?format=csv` on this query carries the same
  no-PII guarantee.
- **PII in audit**: `data.import.stage`'s `audit()` call and `app.audit_import_commit`
  both write only row/entity counts, never row `data`, consistent with `audit.ts`'s own
  "never put free-form user content in before/after/metadata" rule.
- **CSV export formula injection**: `escapeFormula` apostrophe-prefixes any string (or
  JSON-stringified object) cell starting with `=`, `+`, `-`, `@`, tab, or CR — matches
  OWASP CSV injection guidance. Numbers/booleans pass through unescaped, which is safe
  (a plain negative number can't be interpreted as a formula).
- **CSV filename/header injection**: `toCsvResponse`'s `name` arg only reaches the
  `Content-Disposition` header when `result.ok` is true, which only happens when `name`
  matched an exact, developer-registered key in `getRegisteredQueries()` — never
  attacker-controlled free text.
- **Permission matrix vs RLS role sets**: `data.import` (owner/principal/admin) matches
  `commit_import_batch`'s and `import_batches`/`import_rows`' RLS role checks exactly;
  it's a subset of every downstream table's insert/update role set, so no caller gains
  more via import than they already have via direct CRUD.
- **DoS (5,000 rows / 1 MB)**: bounded by `MAX_ROWS` (5,000), `MAX_CSV_BYTES`/dispatcher's
  1 MB body cap, and 500-row insert chunking; no single call can exceed those. There is
  no additional rate limit on how often `data.import.stage`/`commit` can be called
  (consistent with the rest of the codebase, which has no action-level rate limiting) —
  not flagged separately as a new MEDIUM since it requires an already-privileged
  (owner/principal/admin) account and matches the project's existing, unaddressed gap
  rather than one introduced by M04.

## What I checked

- Full diff (`m04-diff.patch`): migration 0066 end-to-end, `imports/{actions,queries,
  query-defs,schemas}.ts`, `csv.ts`, the two route/permission touch points.
- `supabase/config.toml` `[api].schemas` to determine whether `app.*` is PostgREST-
  reachable.
- RLS history for `guardian_students`, `enrolments`, `staff`, `students` (migrations
  0004, 0020, 0025, 0036, 0065) to compare `data.import`'s role set and the definer
  helpers' checks against the tables' real insert/update policies.
- `src/lib/http/dispatch.ts` (body cap, origin check) and `src/lib/actions/{define-
  action,result}.ts` (error mapping, permission gating, test-only context override) for
  how errors and auth reach the HTTP boundary.
- `src/lib/audit.ts` for the audit-event contract imports' audit calls follow.
- Did not run `npm audit` / `pnpm lint` / tests (read-only review, no DB/git commands
  per task scope). Did not execute the migration or exercise the RLS policies against a
  live Postgres instance — conclusions on RLS behavior are from reading the policy SQL,
  not from a runtime proof.
