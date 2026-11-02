# M14-T1 — Lifecycle + people Zod schemas

**Packet:** T1 Lifecycle + people Zod schemas

**Files changed:**
- `src/modules/lifecycle/schemas.ts` (new)
- `src/modules/people/schemas.ts` (append)
- `tests/unit/lifecycle-schemas.test.ts` (new)

**Behavior implemented:**
TDD: wrote 28 unit tests first (all failing), then built schemas. Lifecycle module exports 4 schemas (Promote, Transfer, Withdraw, History) with proper validation: refines guard year inequality, unique mappings, no student in both override+exclude. People module gains StudentUpdate, GuardianUpdate, GuardianLink with strict mode, field refines (≥1 non-id field), and guardian-xor validation. All `.strict()` with `z.infer` types.

**Tests run:**
`pnpm test tests/unit/lifecycle-schemas.test.ts` → 28 passed (28)
`pnpm lint` (on touched files) → 0 errors
`pnpm typecheck` → clean

**Tests not run and why:**
DB tests not applicable (schemas only, no RLS/queries/actions). Security suite not applicable (no actions yet).

**Limitations / honesty label:**
None — schemas are self-contained validation layers, no DB dependency yet. Actions+RLS/queries come in T2–T8.

**Security / integration risks:**
None at schema layer. Downstream actions (T6–T8) must verify permissions and RLS. No secrets. No mutation.

**Follow-ups:**
None. Task complete. Awaits T2–T8 migration/action implementation.

**New dependencies (justification):**
none

**Assumptions made:**
- studentId/guardianId refines via action handlers, not schema (T6–T8 handle FK validation).
- reason text 3–500 range applies to both transfer+withdraw.
- Guardian new-or-reuse logic lives in SQL (T5 definer), not Zod.
