# T-025 — Website editor (block forms, versions, publish)

| Field | Value |
|---|---|
| Lane / Day | B / Day 8 |
| Size | 1 agent-day |
| Critical path | no |
| Review | code-reviewer |
| Feature ids | F-WEB-02 |
| Depends on | T-024 (merged) |
| Migration | — |

## Business outcome
A school admin edits a page block by block, previews the draft, and publishes it; the live site changes instantly and every earlier version remains available.

## Current repo state (verify before starting)
- Blocks schema and renderers exist: `ls src/modules/website/blocks.ts src/modules/website/components/blocks/`.
- `app.publish_page` exists: `grep -n "publish_page" supabase/migrations/20261028000010_website.sql`.
- Tenant layout and nav exist: `ls src/app/(tenant)/[institution]/layout.tsx src/lib/nav.ts`.

## Spec sections to read (only these)
`06-workflows-and-contracts.md §W3` (edit/publish, state diagram), `§1` · `04-architecture.md §6` · `05-data-architecture.md §2.8` · `07 §2` (website.edit, website.publish) · `08 §4 J-01` (draft invisibility re-check).

## Files to inspect first
`src/modules/website/blocks.ts` · `src/modules/website/components/blocks/` (render each block in the preview) · `src/modules/attendance/actions.ts` (action pattern).

## Expected changes
- `src/modules/website/schemas.ts` — `SavePageVersionSchema` (`pageId`, `blocks: BlocksSchema`), `PublishPageSchema`, `CreatePageSchema` (`slug`, `title`), `UpsertNoticeSchema`, `UpsertEventSchema`.
- `src/modules/website/actions.ts` — `createPage`, `savePageVersion` (inserts `page_versions` v+1, never updates), `publishPage` (→ `app.publish_page`), `setWebsiteLive`, `upsertNotice`, `upsertEvent`; permissions `website.edit` / `website.publish`.
- `src/modules/website/queries.ts` — `listPages`, `getPageWithVersions`, `getVersion`, `listNotices`, `listEvents` (member client).
- `src/modules/website/components/` — `PageList`, `BlockEditor` (client: add/remove/reorder blocks; one form per block type driven by the Zod union), `VersionList` (shows published badge), `DraftPreview` (renders blocks with the public renderers inside the tenant app), `NoticeForm`, `EventForm`.
- Pages: `.../website/page.tsx`, `.../website/pages/[pageId]/page.tsx`, `.../website/pages/[pageId]/versions/[versionId]/page.tsx`, `.../website/notices/page.tsx`, `.../website/events/page.tsx`.
- `src/lib/nav.ts` — one line for `/website` (guard `website.edit`).
- Tests: `tests/unit/website-schemas.test.ts`, `tests/db/website-actions.test.ts`, `e2e/website-editor.spec.ts`.

## Must not modify
`supabase/migrations/**` · `src/app/s/**` (public renderer owned by T-024; reuse its components) · `src/lib/auth/permissions.ts`.

## Permissions / nav / migration numbers needed from the lead
Nav line for `/website`. Permissions exist.

## Security and data-integrity requirements
- Saving creates a new version; the editor never mutates `page_versions.blocks`.
- `admissions` role can edit and save drafts but `publishPage` returns `forbidden`.
- Draft preview is rendered only inside the authenticated tenant route; public route untouched.
- Block content is validated by `BlocksSchema` on save (`validation_failed` with `fieldErrors` per block index).

## Acceptance criteria
1. Admin edits the home hero text, saves → new version row; live site unchanged until publish.
2. Publish → live site shows the new text within one reload; `VersionList` marks the published version; older versions open read-only.
3. `admissions` user can save a draft but not publish (`forbidden`).
4. Invalid block (missing hero title) → form shows the field error; no version created.
5. Notices and events created here appear on the public site only when `is_public` and within dates.

## Tests (write failing tests first) and exact commands
- `pnpm test -- tests/unit/website-schemas.test.ts` · `pnpm test:db -- tests/db/website-actions.test.ts` · `pnpm test:e2e -- e2e/website-editor.spec.ts`

## Deliverables
Schemas, actions, queries, editor components, pages, nav line, tests, completion report.

## Assumptions and risks
- Fallback ladder step 2 (`09 §7`): this packet is the first UI dropped if Lane B slips; seeded pages keep the public site working.
- Block reordering uses up/down buttons, not drag-and-drop (no new dependency).

## Completion report
Use the format in `CLAUDE.md`.
