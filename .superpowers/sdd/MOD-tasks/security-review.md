# MOD security review — findings + outcomes

Reviewer pass (pre-fix). Fix pass appends outcomes below each finding.

## CRITICAL — src/app/api/public/enquiry/route.ts

MOD-T8 added a raw `postgres(process.env.SUPABASE_DB_URL as string)` connection (no `max`, no `ssl`
option) inside the public, unauthenticated POST handler, opened and torn down (`sql.end()`) on every
request just to read `institutions.settings` for the module-gate check. This:
(a) bypasses the project's allow-listed service-role access pattern — the file already has a properly
    pooled, allow-listed client (`createPublicEnquiryAdminClient()` from
    `src/modules/website/with-service-role.ts`) sitting a few lines below for the same purpose;
(b) opens a brand-new direct-to-Postgres TCP connection per incoming request before the existing
    IP-hash rate limiter runs (that limiter only guards the later `submit_public_enquiry` RPC), so an
    attacker can trivially exhaust Postgres's (typically low) direct-connection limit and take down the
    DB for every tenant;
(c) leaks the connection if the query itself throws, since `sql.end()` is only reached on the success
    path;
(d) sets no explicit `ssl` option unlike every other call site of `postgres()` in this repo
    (`scripts/hosted-schedule-jobs.ts`, `scripts/seed/sections/finance.ts` pass `ssl: "require"`).

Fix: drop the new `postgres` usage and dependency on this path entirely; use
`createPublicEnquiryAdminClient().from("institutions").select("settings").eq("slug", slug).maybeSingle()`
instead, matching the pooled/allow-listed pattern already used by the RPC call directly below it.

### Outcome: fixed

Removed the `postgres` import and the raw `postgres(...)` connection/query/`sql.end()`. Replaced with
`createPublicEnquiryAdminClient().from("institutions").select("settings").eq("slug", slug).maybeSingle()`,
reusing the client that was already constructed a few lines below (moved its construction up, one
`admin` instance now serves both the lookup and the RPC call). No new connection opened, nothing to
leak on throw, no new unpooled/unencrypted path. Behavior (404 on unknown slug, 404 on disabled
admissions module, 200 + RPC on enabled) is unchanged and covered by the existing
`tests/db/public-enquiry-route.test.ts` suite, which was rerun and stayed green — no new test added
since no observable behavior changed, only the internal data-access path.

## MEDIUM — supabase/migrations/20261028000084_module_enabled.sql

`app.module_enabled`'s SQL mirror diverges from `isModuleEnabled` (src/lib/modules/catalog.ts) on
malformed settings data: TS reads `settings.modules[key]` defensively and falls back to the catalog
default whenever the stored value isn't a boolean, while the SQL version does
`(settings->'modules'->>p_key)::boolean`, which raises a Postgres error (not a graceful fallback) if
that value isn't a valid boolean-castable string. Any stray/garbage value ever written into
`institutions.settings.modules` (e.g. by a future migration, manual fix, or a bug outside
`core.module.set`'s own validated write path) would make `app.module_enabled` — and everything that
calls it, including the `attendance` holiday-block trigger — start throwing for that institution,
whereas the TS path would have silently used the default. The T12 drift test only exercises valid
boolean settings, so it would not catch this asymmetry.

Fix: wrap the cast in a safe parse (e.g.
`case when v_raw in ('true','false') then v_raw::boolean else null end`) so both mirrors degrade the
same way on bad data.

### Outcome: fixed

Migration 0084 is unapplied/untracked (not in the HOSTED-APPLIED list), so edited in place rather than
adding a new migration. Changed the lookup to read the raw text first
(`settings -> 'modules' ->> p_key into v_raw`) and only cast when it is exactly `'true'`/`'false'`;
anything else (missing key, non-boolean string, stray JSON) now falls through to
`coalesce(v_stored, v_default, false)` the same as a missing key, matching `isModuleEnabled`'s
defensive read. Added a failing-first test to
`tests/db/module-enabled-sql.test.ts` ("malformed `modules.<key>` value degrades to the catalog
default instead of raising, matching isModuleEnabled") that writes `{"modules": {"exams": "not-a-bool"}}`
and asserts `app.module_enabled` returns the catalog default (`true`) instead of throwing — confirmed
it failed against the pre-fix function (`invalid input syntax for type boolean`) before the fix, and
passes after. Ran `pnpm db:reset` (DB owner, migration changed) then
`pnpm test:db tests/db/module-enabled-sql.test.ts` — all tests green including the new one.

## LOW — src/app/(tenant)/[institution]/dashboard/page.tsx

Several gating conditions call `isModuleEnabled(ctx, "exams")` / `isModuleEnabled(ctx, "admissions")`
twice in the same expression (e.g. lines ~148–150), a harmless but redundant leftover from the
retrofit; no behavior change needed, just noise worth trimming on next touch.

### Outcome: fixed

Deduplicated the three repeated calls on the lines the finding named (exams rechecks, exams list,
admissions enquiries fetch conditions) — each now calls `isModuleEnabled(ctx, ...)` once per module key
instead of twice. Pure dedup, no logic change; no test needed (no behavior change) per the finding's
own note. `pnpm typecheck`/`pnpm lint` on the touched file stayed clean.
