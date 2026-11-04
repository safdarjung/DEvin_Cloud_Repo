Packet: M15-T12 Acceptance over HTTP
Files changed: tests/db/reports-acceptance.test.ts (new)
Behavior implemented: full HTTP journey — principal POST report.schedule.save (0 20 * * *,
['principal']) -> nextRunAt = next 20:00 IST; teacher POST attendance.mark for today on one
section; next_run_at forced into the past via trusted `sql` caller; real runOnceCore +
createRunnerPorts(admin) sweeps and runs report.generate; principal GET report.runs -> 1 run;
principal POST document.getReadUrl -> signed URL fetch returns CSV whose RA1 row has
percentage 100; owner/admin/teacher/accountant/guardian POST document.getReadUrl on the same
document -> 404 not_found; runner fires again -> still 1 run, next_run_at unchanged at the
next 20:00 IST; principal GET report.export?format=csv -> 200 text/csv, accountant same -> 403.
Tests run: pnpm test:db tests/db/reports-acceptance.test.ts -> 1 passed; pnpm lint -> clean;
pnpm typecheck -> clean.
Tests not run and why: db:reset/db:types/seed/full test:db (non-owner rule, no DB schema
touched). T1-T11 suites not re-run (not this task's files).
Limitations / honesty label: n/a (backend acceptance test only, no UI).
Security / integration risks: none new. Confirms over real HTTP (bearer tokens, no mocks,
real runner) what T3-T11's unit/db suites already proved at the layer boundary: the
restrictive report-document guard refuses every non-recipient role with 404 not_found (not a
silent empty list), and report.export's in-handler source-permission check returns 403 to a
role with data.export but not the source's own read permission.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: (1) fixture institutions (tests/helpers/roles.ts) seed settings as only
`{modules}`, with no `attendance` block — attendance.mark's `.strict()` InstitutionSettingsSchema
parse needs the full 05 §4.1 shape, not just `statuses`, so the test first sets
institutions.settings to `{modules: allModulesOn(), ...DEFAULT_INSTITUTION_SETTINGS}` (no
existing acceptance test exercises attendance.mark, so this gap was previously unseen — not a
T1-T11 bug, since those tasks never call attendance.mark over HTTP). (2) `next_run_at`
expected value computed from a timestamp taken immediately before the first runOnceCore call
(same tiny real-now flake window T10's report already accepted for this cron, not a new risk).
No bug found in a T1-T11 file; no edit made there.
