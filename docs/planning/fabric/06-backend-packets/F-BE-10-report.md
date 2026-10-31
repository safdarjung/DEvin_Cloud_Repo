# F-BE-10 Fixture: Insights — Report

**Packet:** F-BE-10 fixture `insights`

**Files created:**
- `src/modules/fabric/demo/insights.ts`
- `tests/unit/fabric-fixtures/insights.test.ts`

**Implementation:**
- `insights(opts): Insight[]` generates 30 insights with ids "ins-0001" through "ins-0030".
- `insightActions(opts): InsightAction[]` generates 12 actions linked to insights; 5 with outcomes.
- All 7 domains, all 4 kinds. ≥8 entity_refs. Evidence 2–4 items with units. Factors sum ≤1.
- Confidence 0.4–0.95. Pattern text plain-English, no causation. Deterministic per seed.

**Tests passed:**
24 tests in `tests/unit/fabric-fixtures/insights.test.ts` (all pass).
Summary: 865 total passed (added 24), 9 pre-existing failures unrelated.

**Lint:** Clean. **Typecheck:** Not blocked (pre-existing agents.ts syntax error unrelated).
