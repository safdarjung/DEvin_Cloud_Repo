Packet: F-BE-01 wave-0 fixes

Files changed:
- src/components/motion.tsx — FadeIn/Stagger/StaggerItem now CSS entrance (tw-animate-css), motion/react kept only for LayoutPill + AnimatedNumber
- src/app/(tenant)/[institution]/template.tsx — CSS entrance, dropped "use client"/motion
- src/components/breadcrumbs.tsx — extracted pure `crumbsFor`; intermediate segment with no page.tsx renders as text
- tests/unit/breadcrumbs.test.ts — new, 2 tests
- e2e/j00-login-smoke.spec.ts — teacher expectation /attendance -> /today, heading -> greeting regex (today's h1 is time-of-day greeting, not fixed text)
- src/app/(tenant)/[institution]/dashboard/page.tsx — added 2 missing `key` props (lines ~420-421)

Behavior: SSR HTML no longer opacity:0 pre-JS. Breadcrumbs: intermediate no-page segments are plain spans (verified against actual page.tsx tree). Teacher smoke test matches current homePathFor (/today).

Tests run:
- pnpm typecheck → clean
- pnpm lint → clean on touched files (pnpm exec eslint <touched files> → 0 problems). Full `pnpm lint` has 1 pre-existing error in src/modules/fabric/router/use-visual-route.ts — not my packet, untouched by me, ignored per brief.
- pnpm exec vitest run --project unit tests/unit/breadcrumbs.test.ts → 2 passed. (`pnpm test -- tests/unit/breadcrumbs.test.ts` ignores the file filter in this repo's script and runs full suite; full suite has 8 pre-existing failures in tests/unit/nav.test.ts from uncommitted /me route work already in the tree before this session — not touched by me.)

Tests not run: e2e (needs pnpm dev + seeded demo tenant, out of scope for this static fix verification).

Limitations/honesty label: n/a, no UI/badge changes.

Security/integration risks: none — no auth/RLS/action changes.

Follow-ups: none.

New dependencies: none.

Assumptions: PAGE_PATHS in breadcrumbs.tsx hand-built from `find .../[institution] -name page.tsx`; must be updated by hand when routes are added (noted in source comment).
