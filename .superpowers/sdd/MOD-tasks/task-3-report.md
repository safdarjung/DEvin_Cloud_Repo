# MOD-T3 Completion Report

**Packet:** MOD-T3 "Features under modules, `requireModule`, nav filter"

**Files changed:**
- `src/lib/auth/entitlements.ts` — added `module` + `label` to FEATURE_CATALOG; updated `isFeatureEnabled` to check module status
- `src/lib/auth/require.ts` — added `requireModule(ctx, key)` → `notFound()`
- `src/lib/nav.ts` — added `module?` to NavItem, tagged items, updated filter functions to accept settings
- `src/app/(tenant)/[institution]/page.tsx` — pass settings to `homePathFor`
- `src/app/(tenant)/[institution]/layout.tsx` — pass settings to `navItemsFor`
- `tests/unit/entitlements.test.ts` — added module-disable tests
- `tests/unit/nav.test.ts` — added module-filter tests

**Behavior implemented:**
- Features map to required modules (`teacher_ai_*` → `ai_teacher`, `student_ai_*` → `ai_student`)
- `isFeatureEnabled` returns false when feature's module is off
- `requireModule` throws `notFound()` when module disabled
- Nav items `/exams`, `/exams/rechecks`, `/assignments`, `/admissions`, `/website`, `/ai` tagged with modules
- `navItemsFor` and `homePathFor` filter nav items by disabled modules via settings

**Tests run:**
- `pnpm test tests/unit/entitlements.test.ts tests/unit/nav.test.ts` → 36 passed
- `pnpm test tests/unit/nav-routes.test.ts tests/unit/nav-fabric.test.ts` → 7 passed
- `pnpm lint` → clean
- `pnpm typecheck` → clean

**Tests not run and why:**
None — all unit and type tests cover the changes.

**Limitations / honesty label:**
None. Behavior is complete per spec.

**Security / integration risks:**
None. Follows existing patterns (D33 for features, existing module system).

**Follow-ups:**
None for this task.

**New dependencies:**
None.

**Assumptions made:**
- Module defaults from catalog (T1) are correct
- Settings passed as `Record<string, unknown>` per existing pattern
