# T-024 — Public site renderer, blocks, notices/events, enquiry route

| Field | Value |
|---|---|
| Lane / Day | B / Day 6–7 |
| Size | 1.5 agent-days |
| Critical path | no |
| Review | code-reviewer |
| Feature ids | F-WEB-01, F-WEB-03, F-WEB-04 |
| Depends on | T-023, T-026 (merged) |
| Migration | — |

## Business outcome
A visitor opens the school's website, reads pages, notices and events, and submits an admission enquiry that lands in the admissions pipeline — the first two steps of the demo.

## Current repo state (verify before starting)
- Website and admissions tables exist: `grep -n "page_versions\|enquiries" src/lib/db/types.ts | head -4`.
- `app.submit_public_enquiry` exists: `grep -n "submit_public_enquiry" supabase/migrations/20261028000007_admissions.sql`.
- Anon Supabase client helper exists: `grep -n "createAnonClient\|createBrowserClient" src/lib/supabase/*.ts`.

## Spec sections to read (only these)
`04-architecture.md §6`, `§3` (route handlers) · `06-workflows-and-contracts.md §W3` (public enquiry), `§1` · `05-data-architecture.md §2.8` · `07 §1 T5, T12` · `08 §4 J-01, J-02`, `§3 C-81..C-83`.

## Files to inspect first
`src/lib/supabase/server.ts` (add/confirm an anon server client that sends no cookies) · `src/app/layout.tsx` (root layout, fonts) · `src/lib/actions/result.ts` (envelope reuse in route responses).

## Expected changes
- `src/modules/website/blocks.ts` — Zod discriminated union for the eight block types (`hero`, `rich_text`, `image`, `stats`, `notice_list`, `event_list`, `enquiry_form`, `contact`) and `BlocksSchema`; shared with the editor (T-025).
- `src/modules/website/queries.ts` — `getPublicSite(slug)`, `getPublicPage(slug, path)`, `listPublicNotices`, `listPublicEvents` (anon client).
- `src/modules/website/components/blocks/*.tsx` — one renderer per block; `EnquiryForm` (client) posts JSON to `/api/public/enquiry`, shows reference or duplicate message, includes the hidden honeypot field `website`.
- `src/app/s/[slug]/layout.tsx`, `src/app/s/[slug]/[[...path]]/page.tsx` — site nav from `websites.nav`, 404 for unknown slug/path, `generateMetadata`.
- `src/app/api/public/enquiry/route.ts` — Zod-validate body, `ip_hash = sha256(ip + dailySalt)` (`dailySalt = sha256(CRON_SECRET + yyyy-mm-dd)`), call `app.submit_public_enquiry(slug, payload, ip_hash)` with the anon client, map errors to the envelope; always generic success body.
- Tests: `tests/unit/blocks-schema.test.ts`, `tests/db/public-enquiry-route.test.ts`, `e2e/j01-public-site.spec.ts`, `e2e/j02-enquiry.spec.ts`.

## Must not modify
`supabase/migrations/**` · `src/app/(tenant)/**` · `src/modules/admissions/**` (only the SQL function is called).

## Permissions / nav / migration numbers needed from the lead
None.

## Security and data-integrity requirements
- Public routes use the anon client only; never the cookie client or service role.
- Response never reveals whether a phone already exists beyond the generic `duplicate: true` flag defined in `06 §W3`.
- Rich text blocks are rendered from a constrained JSON structure, not raw HTML (no `dangerouslySetInnerHTML`).
- Rate limiting and honeypot live in the SQL function and the route respectively; both tested.

## Acceptance criteria
1. `/s/st-josephs-demo` renders the seeded home page; `/s/st-josephs-demo/admissions` renders; unknown slug → 404.
2. Draft text from an unpublished v2 never appears in the HTML (J-01 asserts on a known draft marker string).
3. Submitting the form creates an `enquiries` row with `source = 'website'` and shows a reference; resubmitting the same phone/child within 24 h shows the duplicate message and creates no row (J-02, C-82).
4. Sixth submission from the same `ip_hash` within an hour → `rate_limited` (C-81); filled honeypot → success body, no row (C-83).
5. Lighthouse-free sanity: page has no console errors; mobile viewport renders (checked in T-041's responsive smoke).

## Tests (write failing tests first) and exact commands
- `pnpm test -- tests/unit/blocks-schema.test.ts` · `pnpm test:db -- tests/db/public-enquiry-route.test.ts` · `pnpm test:e2e -- e2e/j01-public-site.spec.ts e2e/j02-enquiry.spec.ts`

## Deliverables
Blocks schema, renderers, public routes, enquiry route handler, tests, completion report.

## Assumptions and risks
- This packet owns `scripts/seed/sections/website.ts` (four published pages home/about/admissions/contact, 5 notices, 4 events, deterministic) and registers it in the seed order after `admissions`.
- `CRON_SECRET` reuse for the daily salt avoids a new env var; record as an assumption.

## Completion report
Use the format in `CLAUDE.md`.
