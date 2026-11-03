# MOD-T10 Shared pages + AI routes report

**Packet**: MOD-T10 Shared pages + AI routes  
**Files changed**: 9 total  
**Behavior implemented**: Module gating for AI routes (quiz, report-remark, enquiry-reply, dashboard-briefing, attendance-insight) + conditional data fetching in shared pages (dashboard, today, portal) based on module enabled state.

## Tests run

```
pnpm test tests/unit/ai-route-modules.test.ts → 8 passed
pnpm test tests/unit/teacher-agent-route.test.ts tests/unit/student-agent-route.test.ts → 36 passed
```

## Tests not run and why

Database and security tests not required for T10 (no DB changes, no new permissions, no security-sensitive code). The gate test suite (`tests/security/module-gate.test.ts`) requires T13 to run; it tests all actions/queries module gating comprehensively.

## Implementation details

**AI Routes (5 files)**: Added `isModuleEnabled` check after permission check, returns `ai_unavailable` error when module disabled:
- `quiz`: checks `ai_teacher`
- `report-remark`: checks `ai_teacher`
- `enquiry-reply`: checks `ai_teacher`
- `dashboard-briefing`: checks `ai_briefings`
- `attendance-insight`: checks `ai_briefings`

**Shared Pages (3 files)**: Conditional data fetches only run when module enabled, else return empty/null:
- Dashboard: Website (notices/events), Exams (rechecks/exams), Admissions (enquiries)
- Today: Attendance, Exams, Assignments, Notifications, Website
- Portal: Website, Fees, Exams, Assignments, Notifications

## Limitations / honesty label

None. All fixtures remain unbadged per rule 7 exception (batch 2 landing).

## Security / integration risks

None. Module gating is a feature gate, not a security boundary (RLS + permissions unchanged). Disabled modules return graceful no-data states.

## Follow-ups

T11, T12, T13 complete module system; concurrent toggle race (known debt).

## New dependencies

None.

## Assumptions made

- All 5 routes already have POST handlers with existing context/permission/error handling patterns
- Dashboard, today, portal pages use Promise.allSettled for resilient extra fetches
- `isModuleEnabled` correctly handles settings.modules = null/undefined via catalog defaults
