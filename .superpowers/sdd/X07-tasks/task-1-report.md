# X07-T1: Permissions + module key `visitors`

Packet: T-001 Permissions + module key `visitors` (X07-T1)

Files changed:
- `src/lib/auth/permissions.ts` (Permission type + grants to owner/principal/admin/teacher/guardian)
- `src/lib/modules/catalog.ts` (MODULES entry, MODULE_KEYS, OPTIONAL_MODULE_KEYS)
- `src/modules/core/schemas.ts` (visitors: z.boolean().optional() in InstitutionSettingsSchema)
- `tests/unit/permissions.test.ts` (MATRIX rows for visitor.manage, gatepass.manage, pickup.manage)
- `docs/planning/coolskool/07-security-and-ai-governance.md` (3 rows in §2.2 matrix)

Behavior implemented:
- Added Permission union types: `visitor.manage`, `gatepass.manage`, `pickup.manage`
- Assigned to roles per rulings: visitor.manage (owner/principal/admin); gatepass.manage (owner/principal/admin/teacher s); pickup.manage (owner/principal/admin/guardian s)
- Module catalog entry: `visitors` (Operations, default off, no requires)
- Schema accepts `{modules: {visitors: true/false}}`

Tests run:
- `pnpm test tests/unit/permissions.test.ts` → 18 passed
- `pnpm test tests/unit/modules-catalog.test.ts` → 28 passed
- `pnpm test tests/unit/institution-settings.test.ts` → 4 passed
- `pnpm lint` → clean
- `pnpm typecheck` → clean

Tests not run and why:
Module disabled test (C-10.1, visitors-acceptance.test.ts) is T10 scope; drift test stays red until T2 migration.

Limitations / honesty label:
None; full permission matrix + module infra complete per rulings.

Security / integration risks:
None; permissions align with 07 §2.2, module toggle infra mirrors M13 (MOD).

Follow-ups:
T2 migration 0090 builds on this; T1+T2 committed together to resolve drift test.

New dependencies:
None.

Assumptions made:
Module placement after calendar in catalog per rulings; teacher scope mirrors class-teacher rule from gate-pass spec.
