# M25-T1: DailyBrief sources + generator values — Report

**Status: DONE**

**Files changed:**
- `src/modules/fabric/types.ts` — Added `BriefingSource` interface; updated `DailyBrief.generated_by` with rules/cloud_model; added optional `sources`.
- `docs/planning/fabric/05-data-contracts.md` — Added M25 CONTRACT row for both types in Derived: Command Centre.

**Behavior implemented:**
Type exports: `interface BriefingSource { query: string; params: Record<string, unknown> }`. `DailyBrief.generated_by` now accepts "fixture" | "local_model" | "rules" | "cloud_model". Optional `sources?: BriefingSource[]` field tracks the registered queries that fed the brief.

**Tests run:**
- `pnpm lint` → ✓ pass (1 unrelated warning in notifications/templates.ts, pre-existing)
- `pnpm typecheck` → errors in other packets' files (agent/student route, fee-plans/ui-message schemas; pre-existing; ignored per BRIEF-COMMON)
- Unit tests for fabric-fixtures blocked by Vite/postgres infrastructure issue, unrelated to T1 changes

**Tests not run and why:**
`pnpm test tests/unit/fabric-fixtures` — infrastructure error in Vite module runner (charCodeAt not a function in postgres query; occurs on startup before test collection). Not a T1 issue; M25-T2 suite will validate fixture types stay valid.

**Limitations / honesty label:**
None. T1 is type-only, additive. Existing fixtures remain untouched. Mapping is one-way for generated_by: `provider: "local" | "cloud" | null` maps to `"local_model" | "cloud_model" | "rules"` at M25-T4 service layer.

**Security / integration risks:**
None. No schema changes, no RLS, no auth. Pure type contract.

**Assumptions made:**
- `fixture` value retained for legacy DailyBrief fixture (rule 7 honesty badge covers it).
- `sources` remains optional to support future M25 tasks reading persisted rows without migration.
- Contracts doc update uses same line-compactness as existing entries (§3 format).

**New dependencies:**
None.
