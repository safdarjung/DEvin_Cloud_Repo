# T-042 — Security suite completion + review fixes

| Field | Value |
|---|---|
| Lane / Day | Lead / Day 17 (scaffold check Day 9) |
| Size | 1.5 agent-days |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-IDN-03, F-IDN-04, F-AI-01, F-WEB-04, F-IDN-06 |
| Depends on | T-009, all migrations 0001–0010, T-035, T-024 (merged) |
| Migration | — (fixes use a number reserved from `000011+`) |

## Business outcome
Before the demo is deployed, the whole checklist in `07 §6` runs green and an independent security review of migrations and actions has no open CRITICAL/HIGH findings.

## Current repo state (verify before starting)
- Generated suite exists and passes: `pnpm test:security`.
- Every tenant table has an expectation row: `grep -c "^  [a-z_]*:" tests/security/rls-expectations.ts` equals the count of public tables with `institution_id`.
- Action registry populated: `grep -c registerAction src/modules/*/actions.ts`.

## Spec sections to read (only these)
- `07-security-and-ai-governance.md §1` (threat table, controls), `§4` (allow-list), `§6` (every C-id with mechanism).
- `08-testing-and-acceptance.md §3` (C-10…C-14, C-44, C-54, C-80…C-83, C-04), `§7` (checkpoint gate).
- `10-backlog-index.md §3–4` (reserved fix numbers, review rules).

## Files to inspect first
- `tests/security/*`, `src/lib/actions/registry.ts`, `src/lib/ai/gateway.ts`, `src/app/api/public/enquiry/route.ts`, `supabase/migrations/*.sql` (grep `security definer`, `grant execute`).

## Expected changes
- `tests/security/bola.test.ts` — C-10…C-14: foreign ids for students, guardians, invoices, results, attendance for every role → 0 rows / `not_found`.
- `tests/security/escalation.test.ts` — C-03 (registry walk): every registered action called as every unauthorized role returns `forbidden`; unknown keys → `validation_failed`.
- `tests/security/guardian-scope.test.ts` — C-44, C-54.
- `tests/security/ai-egress.test.ts` — C-62 (provider factory spy under `local_only`), C-63 (no network under fallback without key).
- `tests/security/public-site.test.ts` — C-80 (anon PostgREST select on `page_versions` returns only published), C-81, C-83.
- `tests/security/demo-reset.test.ts` — C-04 (if not already covered by T-012; otherwise reference).
- `tests/security/allow-list.test.ts` — C-90: grep `src/**` for `@/lib/supabase/admin` imports outside allow-listed paths; C-91 handled by CI (assert workflow file exists).
- Run the `security-reviewer` agent over `supabase/migrations/**`, `src/lib/auth/**`, `src/lib/actions/**`, `src/lib/ai/**`, `src/modules/*/actions.ts`; triage findings; fix CRITICAL/HIGH in a new migration `20261028000011_security_fixes.sql` (reserved) or in TS; MEDIUM logged in `12 §3`.
- Update `07 §6` table only if a C-id's mechanism changed (note in report; lead approves).

## Must not modify
- Merged migrations (fixes go in 0011+); `tests/security/rls-expectations.ts` semantics (only add missing rows with the owning lane's confirmation).

## Permissions / nav / migration numbers needed from the lead
- Reserve `20261028000011_security_fixes.sql` if any SQL fix is needed.

## Security and data-integrity requirements
- Tests use fixture institutions only; never the seeded demo tenant on hosted.
- A finding is closed only with a test that would have caught it.
- No test weakens a policy to pass; if an expectation is wrong, fix the expectation with lane sign-off.

## Acceptance criteria
1. `pnpm test:security` runs every C-id in `07 §6` (grep the ids in test titles) and passes.
2. Security review report attached to the completion report: findings by severity, each CRITICAL/HIGH with fix commit and covering test.
3. `grant execute` audit: every `app.*` function's grants match `07 §4` (script output in report).
4. Full suite green on local; Day 17 checkpoint gate met (`08 §7`).
5. Debt register updated for accepted MEDIUM/LOW items.

## Tests (write failing tests first) and exact commands
- Files above; command: `pnpm test:security`; `pnpm test && pnpm test:db` (regression).

## Deliverables
- Security tests, fixes, review report, grants audit script `scripts/audit-grants.sql`, updated debt rows, completion report.

## Assumptions and risks
- Registry walk requires every module to register actions; missing registrations fail the test by design (count must equal `grep -c defineAction`).
- Time-boxed: findings not fixable by end of Day 17 block deploy only if CRITICAL/HIGH.

## Completion report
Use the format in `CLAUDE.md`.
