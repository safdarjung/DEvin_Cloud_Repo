# M17-T4 Completion Report

**Packet:** M17-T4 Badge flips on delivery row status  
**Files changed:**
- `src/modules/notifications/components/MessageLog.tsx` — status badge logic updated
- `src/modules/core/components/dashboard/RecentActivity.tsx` — section badge conditional
- `src/app/(tenant)/[institution]/dashboard/page.tsx` — activityHasSimulated computation + badge conditional
- `src/modules/notifications/queries.ts` — C-31 doc comment updated for email Resend status
- `tests/unit/delivery-badge.test.ts` — new test file (TDD)

**Behavior implemented:**
MessageLog now shows `<SimulatedBadge />` only when `row.status === "simulated"`, otherwise renders the delivery status badge (sent/failed/queued). Dashboard and RecentActivity show section-level badge only when any shown row is simulated. Email rows may now carry sent/failed status with Resend (M17 ruling).

**Tests run:**
- `pnpm test tests/unit/delivery-badge.test.ts` → 3 passed ✓
- `pnpm lint` (MessageLog, RecentActivity, queries.ts) → 0 errors ✓
- `pnpm typecheck` → 0 errors ✓

**Tests not run and why:**
Full `pnpm test` + `pnpm test:db` deferred to lead (brief scope: unit test only).

**Limitations / honesty label:**
None. Badge flip follows ruling: simulated rows display badge, sent/failed rows show status. Historic simulated rows retain badge.

**Security / integration risks:**
None. Read-only changes. No new permissions, RLS, or queries.

**New dependencies:**
None.

**Assumptions made:**
- DeliveryLogRow.status type assumes "simulated" | "sent" | "failed" | "queued" (existing schema)
- dashboard page HomeActivity component accepts `badge={undefined}` (shadows type silently expected)
