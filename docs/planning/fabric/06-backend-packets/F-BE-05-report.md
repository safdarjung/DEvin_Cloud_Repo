# F-BE-05: Fixture `command` — Completion Report

**Files changed:** `src/modules/fabric/demo/command.ts`, `tests/unit/fabric-fixtures/command.test.ts`

**Behavior implemented:**
- `dailyBrief(opts, role)`: 5–7 deterministic brief items per role (principal, teacher, guardian, student) with insight_id refs and hrefs
- `priorityActions(opts)`: 8 priority actions with hrefs, severity, owner, due date
- `forecastCards(opts)`: 4 KPI forecast cards (attendance, fee collection, admissions, teacher load)
- `riskIndicators(opts)`: 6 risk items with level, trend, optional insight_id
- `defaultWidgetOrder(role)`: Role-specific widget IDs for dashboard layout

**Tests run:** `pnpm test tests/unit/fabric-fixtures/command.test.ts` → **23 passed**

**Tests not run:** Full suite runs against different fixture files (not blocked)

**Limitations / honesty:** None. Fixtures are deterministic and use Indian CBSE school context (names, fees in paise, section labels). All hrefs routed to `/fabric/*`.

**Security / integration risks:** None. Pure fixtures; no external calls or secrets.

**New dependencies:** None
