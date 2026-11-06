Packet: X01-T1 Module keys `student_leave`, `diary`

Files changed:
- src/lib/modules/catalog.ts
- tests/unit/modules-catalog.test.ts
- src/modules/core/schemas.ts

Behavior implemented:
Added `student_leave` and `diary` modules to Communication category, both with default true, no requires. Exported as MODULES.student_leave and MODULES.diary. Added keys to MODULE_KEYS and OPTIONAL_MODULE_KEYS; included ptm in schema (was in catalog but missing).

Tests run:
`pnpm test tests/unit/modules-catalog.test.ts tests/unit/institution-settings.test.ts` → 35 passed (28 existing + 7 settings; +3 new: includes_student_leave_diary, parse_diary_false, return_default_true_student_leave).

Tests not run and why:
None blocked.

Limitations / honesty label:
None. Both modules default enabled; schema validates.

Security / integration risks:
None. Catalog and schema additions follow MOD pattern.

Follow-ups:
T4 adds SQL migration for module_catalog inserts.

New dependencies:
None.

Assumptions made:
ptm added to schema (already in catalog, schema validation depends on it).
