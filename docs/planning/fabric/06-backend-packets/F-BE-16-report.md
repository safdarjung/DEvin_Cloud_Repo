# F-BE-16: Fabric fixture `personal`

Created `src/modules/fabric/demo/personal.ts`:
- `personalMemories()`: 15 deterministic items (mixed kinds, ~5 shared, some with expire dates, realistic content ≤300 chars)
- `personalGoals()`: 4 goals with 3–5 tasks each, progress computed from task completion
- `workspaces()`: personal (current), institution "St Joseph's", household
- `boundaryPreview()`: Pure; revokes inferred context shared memories, strips flag from remaining ones, explains in one sentence

Tests: `tests/unit/fabric-fixtures/personal.test.ts` — 22 tests covering determinism, counts, immutability, spec conformance.

Verification: `pnpm lint` ✓ · `pnpm vitest run tests/unit/fabric-fixtures/personal.test.ts` ✓ (22/22 pass).
