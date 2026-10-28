# T-026 — Migration 0007: admissions + RLS + `submit_public_enquiry`

| Field | Value |
|---|---|
| Lane / Day | B / Day 5 |
| Size | 0.5 agent-days |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-ADM-01, F-ADM-02, F-WEB-04 |
| Depends on | T-011 (merged) |
| Migration | `supabase/migrations/20261028000007_admissions.sql` |

## Business outcome
Leads and applications are stored with a clear state model, and the public website can create a lead safely without exposing anything to anonymous users.

## Current repo state (verify before starting)
- Migrations 0001–0005 merged: `ls supabase/migrations/ | grep -c 2026102800` ≥ 5.
- Helpers: `grep -n "next_sequence\|enqueue_job\|has_role\|block_mutation" supabase/migrations/20261028000001_foundation.sql supabase/migrations/20261028000003_platform.sql`.
- `grades`, `academic_years`, `staff` exist: `grep -n "create table public.grades" supabase/migrations/20261028000005_academics.sql`.

## Spec sections to read (only these)
`05-data-architecture.md §2.5`, `§4.1` (admissions, numbering), `§5` · `06-workflows-and-contracts.md §W3` (inside the function), `§W4` (states only), `§3` (enquiry_received) · `07 §1 T12`, `§2` (admissions.*), `§4` · `08 §3 C-81..C-83`.

## Files to inspect first
`supabase/migrations/20261028000002_core.sql` (policy/grant style) · `supabase/migrations/20261028000001_foundation.sql` (`app.next_sequence` signature) · `tests/security/rls-expectations.ts`.

## Expected changes
- `supabase/migrations/20261028000007_admissions.sql`:
  - tables `enquiries`, `applications`, `application_decisions` per `05 §2.5`; `app.block_mutation` on `application_decisions`; status check constraints; indexes incl. `(institution_id, phone, created_at)` and `(institution_id, source_ip_hash, created_at)`.
  - `app.submit_public_enquiry(slug text, payload jsonb, ip_hash text) returns jsonb` security definer, executable by `anon`: resolve institution by slug with a live website (else `code:not_found`); count enquiries with this `ip_hash` in the last 60 min ≥ 5 → `code:rate_limited`; duplicate (`phone`, `lower(child_name)`) in 24 h → return `{ enquiry_id, reference, duplicate: true }`; insert enquiry (`source = 'website'`, `status = 'new'`, `grade_applied_id` resolved from `payload->>'gradeCode'`), `app.enqueue_job(institution_id, 'notify.enquiry_received', {...}, 'enquiry:<id>')`; return `{ enquiry_id, reference, duplicate: false }` where `reference = 'ENQ-' || left(id::text, 8)`.
  - RLS: all three tables SELECT/INSERT/UPDATE for `app.has_role(institution_id, '{owner,principal,admin,admissions}')`; no anon policies (anon only reaches the function); no DELETE.
  - `application_no` allocated via `app.next_sequence(institution_id, 'application_no')` in a BEFORE INSERT trigger when null.
- `src/lib/db/types.ts` regenerated · `tests/security/rls-expectations.ts` entries · `tests/db/admissions-schema.test.ts`.

## Must not modify
Other migrations · `src/**` · `scripts/**`.

## Permissions / nav / migration numbers needed from the lead
None (0007 reserved).

## Security and data-integrity requirements
- The function validates `payload` keys and lengths in SQL (child_name ≤ 120, phone matches `^[6-9][0-9]{9}$`), never trusting the route alone.
- `source_ip_hash` is stored; raw IPs never.
- Function `execute` granted to `anon` and `authenticated`; all other functions in this file revoked from both.

## Acceptance criteria
1. Fresh `pnpm db:reset` applies 0007; types regenerated.
2. As anon: 5 calls with distinct phones succeed; the 6th within the hour → `code:rate_limited` (C-81).
3. Same phone + child name twice → second returns `duplicate: true`, one row (C-82).
4. Unknown slug or website not live → `code:not_found`; anon `select * from enquiries` → 0 rows.
5. `applications` insert without `application_no` gets `APP/2026/00001`-style number; teacher role cannot read enquiries (generated suite).

## Tests (write failing tests first) and exact commands
- `tests/db/admissions-schema.test.ts` (C-81, C-82, not_found, numbering, role access).
- `pnpm test:db -- tests/db/admissions-schema.test.ts` · `pnpm test:security`

## Deliverables
Migration, types, expectations, tests, completion report listing `app.submit_public_enquiry` for `07 §4`.

## Assumptions and risks
- Honeypot handling (C-83) lives in the route (T-024), not here.
- `app.enrol_applicant` is defined in 0008 (T-030) because it needs finance tables; this packet must not create it.

## Completion report
Use the format in `CLAUDE.md`.
