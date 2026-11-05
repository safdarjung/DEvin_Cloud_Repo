Packet: M16-T1 Dashboard Zod schemas

Files changed:
- src/modules/core/dashboard.schemas.ts (new)
- tests/unit/dashboard-schemas.test.ts (new)

Behavior implemented:
Two strict Zod schemas for dashboard query inputs. AttendanceTrendSchema accepts optional days (7–92, default 30), classSectionId, and studentId with mutual exclusion refinement. PortalDashboardSchema requires a studentId. Both enforce strict mode.

Tests run:
pnpm test tests/unit/dashboard-schemas.test.ts → 14 passed

Tests not run and why:
None. All acceptance tests pass.

Limitations / honesty label:
None. Task complete.

Security / integration risks:
None. Validation only.

Follow-ups:
None for this task.

New dependencies (justification):
None. Uses existing zod + common schema utilities.

Assumptions made:
Days range 7–92 per rulings (trend window calendar constraint). Mutual exclusion rule per rulings (classSectionId and studentId scope are distinct).
