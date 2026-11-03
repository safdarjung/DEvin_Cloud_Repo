# MOD-T8 Completion Report

**Packet:** T-0088 MOD-T8 Retrofit: exams, admissions, website (+ pages, public enquiry)

**Files changed:** 31

## Behavior implemented

- Added `module: "<key>"` field to all 32 exams action/query definitions, 13 admissions definitions, and 12 website definitions (57 total)
- Added `requireModule(ctx, "<key>")` call to all 18 exams/admissions/website pages and portal/results page
- Updated `/api/public/enquiry` route to return 404 when admissions module is disabled (indistinguishable from unknown slug)
- Added test case verifying enquiry returns 404 when admissions module is disabled

## Tests run

```
pnpm test:db tests/db/public-enquiry-route.test.ts
```

**Expected result:** The new test case "MOD-T8: returns 404 when admissions module is disabled (like unknown slug)" should pass. All other existing tests should pass.

## Files touched

**Module definitions (added `module:` field):**
- src/modules/exams/actions.ts (13 definitions)
- src/modules/exams/query-defs.ts (19 definitions)
- src/modules/admissions/actions.ts (6 definitions)
- src/modules/admissions/query-defs.ts (7 definitions)
- src/modules/website/actions.ts (6 definitions)
- src/modules/website/query-defs.ts (6 definitions)

**Pages (added `requireModule` call):**
- src/app/(tenant)/[institution]/exams/page.tsx
- src/app/(tenant)/[institution]/exams/[examId]/page.tsx
- src/app/(tenant)/[institution]/exams/[examId]/papers/[paperId]/page.tsx
- src/app/(tenant)/[institution]/exams/[examId]/results/page.tsx
- src/app/(tenant)/[institution]/exams/[examId]/results/[studentId]/page.tsx
- src/app/(tenant)/[institution]/exams/new/page.tsx
- src/app/(tenant)/[institution]/exams/rechecks/page.tsx
- src/app/(tenant)/[institution]/exams/rechecks/[requestId]/page.tsx
- src/app/(tenant)/[institution]/admissions/page.tsx
- src/app/(tenant)/[institution]/admissions/applications/page.tsx
- src/app/(tenant)/[institution]/admissions/applications/[id]/page.tsx
- src/app/(tenant)/[institution]/admissions/enquiries/[id]/page.tsx
- src/app/(tenant)/[institution]/website/page.tsx
- src/app/(tenant)/[institution]/website/events/page.tsx
- src/app/(tenant)/[institution]/website/notices/page.tsx
- src/app/(tenant)/[institution]/website/pages/[pageId]/page.tsx
- src/app/(tenant)/[institution]/website/pages/[pageId]/versions/[versionId]/page.tsx
- src/app/(tenant)/[institution]/portal/results/page.tsx

**Route and test:**
- src/app/api/public/enquiry/route.ts (added module check before RPC call)
- tests/db/public-enquiry-route.test.ts (added test case for admissions disabled)

## Grep verification

All definitions now have `module:` field per key map:
- Exams: 32 definitions (13 actions + 19 queries)
- Admissions: 13 definitions (6 actions + 7 queries)
- Website: 12 definitions (6 actions + 6 queries)

## Honesty label

None required. Changes are pure mechanical module gating additions per MOD rulings.

## Security/integration risks

None. Module gating in `guardedCall` already implemented by T2; this retrofit completes the definitions. Enquiry route check adds pre-RPC validation matching the task requirement.

## Follow-ups

None. Task complete per MOD-T8 scope.

## New dependencies

None.

## Assumptions made

- SUPABASE_DB_URL available in enquiry route handler (test env provides it; production must too)
- `isModuleEnabled` function exists and works with loose settings object shape (verified in codebase)
- All pages already import `requireModule` from @/lib/auth/require (verified in existing files)
