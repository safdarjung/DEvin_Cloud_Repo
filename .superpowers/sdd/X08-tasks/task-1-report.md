Packet: X08-T1 Module key `ptm` + permissions
Files changed: src/lib/modules/catalog.ts, src/lib/auth/permissions.ts, tests/unit/permissions.test.ts, tests/unit/modules-catalog.test.ts, docs/planning/coolskool/07-security-and-ai-governance.md
Behavior implemented: Added `ptm` module (category Communication, default false) to catalog after `sms`. Added 5 new permissions: `ptm.manage`, `ptm.slot.manage`, `ptm.book`, `survey.manage`, `survey.respond` with correct role assignments per rulings. Updated permission matrix in 07 §2.2 with 5 rows (ptm.manage, ptm.slot.manage with s=teacher scope, ptm.book with s=guardian scope, survey.manage, survey.respond) including RLS notes.
Tests run: `pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts tests/unit/modules-catalog.test.ts` → 3 files, 50 passed
Tests not run and why: —
Limitations / honesty label: —
Security / integration risks: —
Follow-ups: T2 (migration 0099) will turn green the drift test `tests/db/module-enabled-sql.test.ts`; C-03 fixtures in T5/T7
New dependencies (justification): none
Assumptions made: PTM module default=false per rulings; InstitutionSettingsSchema already includes `ptm: z.boolean().optional()` from prior state
