# T-023 — Migration 0010: website + public RLS + `publish_page`

| Field | Value |
|---|---|
| Lane / Day | B / Day 5 |
| Size | 0.5 agent-days |
| Critical path | no |
| Review | security-reviewer + lead |
| Feature ids | F-WEB-01, F-WEB-02, F-WEB-03 |
| Depends on | T-011 (merged) |
| Migration | `supabase/migrations/20261028000010_website.sql` |

## Business outcome
The public site can be served to anonymous visitors from published content only, while drafts stay private, and publishing is a single audited database operation.

## Current repo state (verify before starting)
- Migrations 0001–0005 merged: `ls supabase/migrations/ | grep -c 2026102800` ≥ 5.
- Helpers: `grep -n "has_role\|block_mutation\|audit(" supabase/migrations/20261028000001_foundation.sql`.
- Expectations file: `ls tests/security/rls-expectations.ts`.

## Spec sections to read (only these)
`05-data-architecture.md §2.8`, `§5` (class P), `§6` · `04-architecture.md §6` · `06-workflows-and-contracts.md §W3` (edit/publish) · `07 §1 T5`, `§2` (website.*) · `08 §3 C-80`.

## Files to inspect first
`supabase/migrations/20261028000002_core.sql` (policy and grant style) · `tests/security/rls-expectations.ts`.

## Expected changes
- `supabase/migrations/20261028000010_website.sql`:
  - tables `websites`, `pages`, `page_versions`, `notices`, `events` per `05 §2.8` (unique(institution_id) on websites; unique(website_id, slug); unique(page_id, version_no)); `app.block_mutation` on `page_versions` UPDATE/DELETE except setting `published_at` inside `app.publish_page`; `set_updated_at` elsewhere.
  - `app.publish_page(page_id, version_id)` security definer: caller `app.has_role(institution_id, '{owner,principal,admin}')`; version must belong to the page; sets `pages.published_version_id`, stamps `page_versions.published_at` (via `set local app.allow_publish = 'on'` consulted by the guard trigger); `app.audit('website.page.published')`.
  - RLS class P for `anon`: `websites` where `is_live`; `pages` where `published_version_id is not null` and website live; `page_versions` where `id in (select published_version_id from pages …)`; `notices` where `is_public and publish_at <= now() and (expires_at is null or expires_at > now())`; `events` where `is_public`. Members: SELECT all rows of their institution; INSERT/UPDATE for `website.edit` roles (`owner,principal,admin,admissions`).
- `src/lib/db/types.ts` regenerated · `tests/security/rls-expectations.ts` entries (with an `anon` expectation column) · `tests/db/website-schema.test.ts`.

## Must not modify
Migrations 0001–0009 · `src/modules/**` · `src/app/**`.

## Permissions / nav / migration numbers needed from the lead
None (0010 reserved).

## Security and data-integrity requirements
- No anon policy may reference a draft version; test by selecting `page_versions` as anon after creating a draft v2 for a published page.
- `page_versions` are immutable apart from `published_at`, set only by the function.
- `websites.is_live = false` hides every page even if versions are published.

## Acceptance criteria
1. Fresh `pnpm db:reset` applies 0010; types regenerated.
2. C-80 fixture: page with v1 published and v2 draft → anon `select * from page_versions` returns v1 only; anon on a non-live website returns nothing.
3. `app.publish_page` as `admissions` role → policy/role error; as `admin` → published, audit row present; publishing a version of a different page → `code:validation_failed`.
4. UPDATE of `page_versions.blocks` raises; DELETE raises.
5. Generated RLS suite green including anon expectations.

## Tests (write failing tests first) and exact commands
- `tests/db/website-schema.test.ts` (C-80, publish function, immutability).
- `pnpm test:db -- tests/db/website-schema.test.ts` · `pnpm test:security`

## Deliverables
Migration, types, expectations, tests, completion report listing `app.publish_page` for `07 §4`.

## Assumptions and risks
- The generated suite needs an `anon` role in `tests/helpers/roles.ts`; if T-009 did not add it, add `clientAs('anon')` there in this packet and note it (small, allowed exception).

## Completion report
Use the format in `CLAUDE.md`.
