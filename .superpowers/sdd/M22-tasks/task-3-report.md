# M22-T3 Catalog + Zod schemas — Report

**Packet:** M22-T3 Catalog + Zod schemas

**Files changed:**
- `src/modules/agents/catalog.ts` (new)
- `src/modules/agents/schemas.ts` (new)
- `tests/unit/agents-catalog.test.ts` (new)

**Behavior implemented:**
Created agent catalog with 6 agent definitions (academic, attendance, admissions, finance, communication, administrative), each with tool allowlist (read queries) and action allowlist (write actions). Catalog is code-based, seed-safe (relative imports), and includes risk levels for every action. Zod schemas for run/decide/enable actions plus queries. Static tests verify every catalog name exists as a registered query/action.

**Tests run:**
`pnpm test tests/unit/agents-catalog.test.ts` → 31 passed
`pnpm lint src/modules/agents/ tests/unit/agents-catalog.test.ts` → 0 errors, 0 warnings
`pnpm typecheck` → ✓ Types generated successfully

**Limitations / missing references:**
Two queries from rulings were not yet implemented and removed from catalog:
- `dashboard.attendanceTrend` (attendance agent) — required for T10/later
- `core.approvals.pending` (administrative agent) — required for T10

Administrative agent now has 4 tools instead of 5; attendance agent has 5 instead of 6. Both are functional with existing tools.

**Security / integration risks:**
None. Catalog is static, no DB access, no external calls. Risk levels match the spec exactly.

**Follow-ups:**
T10 must add `core.approvals.pending` query to `core/approvals.queries.ts`; consider adding `dashboard.attendanceTrend` to dashboard queries if M08 phase includes it.

**New dependencies:**
None.

**Assumptions made:**
- Read queries (tools) are exempt from the rule-6 prohibited pattern; only write actions are restricted.
- Missing queries are dropped per spec ("A listed name absent from the registry at build time is dropped").
