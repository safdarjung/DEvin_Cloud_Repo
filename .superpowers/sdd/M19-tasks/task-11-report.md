Packet: M19-T11 Detectors: workload + timetable conflicts
Files changed: src/modules/insights/detectors/workload.ts (new); src/modules/insights/detectors/timetable-conflicts.ts (new); tests/unit/insights-detector-timetable.test.ts (new)
Behavior implemented:
- `WorkloadSourceRow`, `detectWorkload(rows, asOf, maxPeriods)`, `workloadDetector` (key workload, module timetable, v1, rpc `insight_src_workload`, paged in 1000s ordered by version_id, staff_id). Fires when periods_week > max; warning at >= max+4, else watch; confidence 0.95; entity staff, label null, class_section_id null; evidence `Periods per week`, `Limit`; title verbatim. max = `settings.timetable.max_periods_week` if a positive number, else 36 (same check as M07 `maxPeriodsPerWeek`).
- `RoomCapacitySourceRow`, `detectRoomCapacity(rows, asOf)`, `timetableConflictsDetector` (key timetable-conflicts, module timetable, v1, rpc `insight_src_room_capacity`, paged, ordered by version_id, class_section_id). Fires for every row; warning if strength - smallest >= 10 or slots_over >= 12, else watch; confidence 0.95; entity section, label = section_label (<= 60), class_section_id set; evidence `Section strength`, `Smallest room capacity`, `Periods in too-small rooms`; title `Rooms too small for <label>`.
- Both: window (dedupe_key tail) = version_id; no names or ids in title/pattern.
Tests run: `pnpm test tests/unit/insights-detector-timetable.test.ts` -> RED first (modules missing), then 12/12 passed; `pnpm lint` -> clean (whole repo); `pnpm typecheck` -> clean. Plain `node` import of both files (jobs:run runtime) -> loads and detects (warning/watch).
Tests not run and why: no DB tests (task: no DB commands; detectors are pure + fake-rpc tests; T6 owns the source SQL tests).
Limitations / honesty label: none needed (real detections, no UI).
Security / integration risks: none new; service-role rpc only via the Detector contract; candidates hold counts and section labels only. The max-periods default is duplicated from src/modules/timetable/queries.ts because that file uses `@/` and the cookie client (jobs:run cannot load it).
Follow-ups: T14 registers workloadDetector and timetableConflictsDetector in DETECTORS.
New dependencies (justification): none
Assumptions made:
- date_from = date_to = as_of for both signals (the rulings give no date range for version-window signals; the insight is a snapshot of the published timetable on that day).
- Max periods requires > 0 (M07 precedent); a 0 or negative setting falls back to 36.
- Patterns and recommended_actions wording written by me (actions have no numbers or names, <= 160 chars).
