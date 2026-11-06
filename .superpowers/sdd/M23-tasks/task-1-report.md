Packet: M23-T1 Permissions + CONTRACT "report"

Files changed:
- src/lib/auth/permissions.ts (added `workflow.read` | `workflow.manage` to Permission union; matrix rows in ROLE_PERMISSIONS)
- src/modules/fabric/types.ts (added "report" to WorkflowNodeType union)
- tests/unit/permissions.test.ts (verified matrix snapshot)
- docs/planning/coolskool/07-security-and-ai-governance.md (§2.2 rows added)

Behavior implemented:
- Permission union extended with `workflow.read` (queries) and `workflow.manage` (save, status, run now, approval decisions)
- Owner + principal + admin hold `workflow.read`; owner + principal hold `workflow.manage`
- Teacher, accountant, admissions, exam_controller, guardian, student hold neither
- `WorkflowNodeType` union extended: `"report"` added; `"tool"` retained for fixture compatibility
- Matrix snapshot in permissions test verifies against 07 §2.2 exactly

Tests run:
- `pnpm test tests/unit/permissions.test.ts` → 33/33 PASS
- `pnpm test tests/unit/workflows-schemas.test.ts` → 49/49 PASS (T5 dependency)
- `pnpm test tests/unit/notification-templates.test.ts` → 16/16 PASS (T6)
- `pnpm test tests/unit/workflows-templates.test.ts` → 22/22 PASS (T9 dependency)
- `pnpm typecheck` → clean
- `pnpm lint` → clean (8 warnings in unrelated files; 0 errors)

Total haiku tests: 120/120 PASS

Limitations / honesty:
None. Pure permission matrix addition, no new SQL or business logic beyond CONTRACT node type.

Security / integration risks:
None. No changes to authorization logic; only extension of the permission enum.

New dependencies:
None.

Assumptions made:
- Master plan 07 §2.2 rows per rulings; "report" as contractual addition for T1–T12 workflow node types.
- All haiku tasks (T1, T5, T6, T9) now complete; T22 blocked awaiting Sonnet T21.
