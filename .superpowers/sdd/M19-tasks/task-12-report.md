Packet: M19-T12 Detector: resource shortage
Files changed: src/modules/insights/detectors/resource-shortage.ts (new); tests/unit/insights-detector-rooms.test.ts (new)
Behavior implemented: `RoomSourceRow`, `detectRoomPressure(rows, asOf)`, `resourceShortageDetector` (key resource-shortage, module timetable, v1, rpc insight_src_rooms, unpaged — rows = rooms in the institution, far below max_rows). total = rows[0].periods_total; [] when 0 or no rows. in-use = periods_used>=1; hot = used/total>=0.9 (integer compare). Fires hot>=2 and hot>=0.2·in-use; warning if hot>=0.4·in-use or any hot room has open_maintenance>=1, else watch. Confidence fixed 0.9. Evidence: Rooms >=90% booked, Rooms in use, Open repairs in busy rooms (summed over hot rooms only), then top 3 hot rooms by booked% (ties by room name) as "<name> booked". Title "Teaching rooms close to full"; signal operations.room_pressure, school-level (entity null), dedupe window = version_id (not ISO week, per Signals table).
Tests run: `pnpm test tests/unit/insights-detector-rooms.test.ts` -> RED first (moved impl aside, import failed), restored, GREEN 11/11; `pnpm lint` -> clean; `pnpm typecheck` -> clean.
Tests not run and why: no DB tests (task: no DB commands; detector is pure fn + fake-rpc tests, matching T8/T10 precedent).
Limitations / honesty label: none (real detection, no UI).
Security / integration risks: none new; evidence/pattern hold counts, %, and room names only (room names are not personal data; one-owner rule is about student/staff names).
Follow-ups: T14 registers resourceShortageDetector in DETECTORS (Signals-table order, last of the 8).
New dependencies (justification): none
Assumptions made:
- date_from = date_to = asOf: ruling gives no explicit date range for this snapshot signal (window is version_id, unlike the ISO-week detectors); used asOf as the single as-of date, consistent with the source being a point-in-time schedule snapshot.
- "Open repairs in busy rooms" evidence sums open_maintenance across hot rooms only (not all in-use rooms), matching the "a hot room with open repairs -> warning" test wording.
- Confidence is the fixed literal 0.9 from the ruling (not run through `confidence()`), matching the admissions.ts precedent for a stated fixed value.
- recommended_actions (2 strings) and pattern sentence text are mine, per rulings "the implementer writes them".
