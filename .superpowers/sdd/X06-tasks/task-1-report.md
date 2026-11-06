Packet: X06-T1 Module key `exam_seating` + permission `exam.seating.read`

Files changed:
- `src/lib/modules/catalog.ts` (entry after `exams`, MODULE_KEYS, OPTIONAL_MODULE_KEYS arrays)
- `src/lib/auth/permissions.ts` (Permission union, ROLE_PERMISSIONS for 6 roles: owner, principal, admin, exam_controller, student, guardian)
- `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 (one matrix row)

Behavior implemented:
- `exam_seating` module off by default; requires `exams` to be enabled
- `exam.seating.read` permission granted to owner, principal, admin, exam_controller, student (scoped to own seat), guardian (scoped to own child's seat)
- Permission denied to teacher, admissions, accountant

Tests run:
`pnpm test tests/unit/modules-catalog.test.ts tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts` → 56 passed

Lint: clean
Typecheck: unrelated error in `tests/unit/certificate-html.test.ts` (different packet); T1 files clean

Limitations / honesty label: none

Security / integration risks: none

Follow-ups: T2 (migration 0088 part A); other T3+ tasks in X06

New dependencies: none

Assumptions made: none

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
