# F-BE-15 Studio Fixtures

**Files:** `src/modules/fabric/demo/studio.ts` (448 lines); `tests/unit/fabric-fixtures/studio.test.ts` (134 lines)

**Behavior:** 4 requests (submitted/proposed/building/delivered) with realistic asks. 4 matching proposals, resolution varied. Preview_html: static HTML 2796 bytes, no scripts. `interpretRequest()` keyword heuristic: report→config, integrat/GPS/payment→integration, else new_module.

**Verify:** `pnpm lint` clean. No new deps.
