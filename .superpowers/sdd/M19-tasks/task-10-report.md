Packet: M19-T10 Detectors: fees + admissions
Files changed: src/modules/insights/detectors/fees.ts (new); src/modules/insights/detectors/admissions.ts (new); tests/unit/insights-detector-office.test.ts (new)
Behavior implemented: `FeesSourceRow`, `detectFees(row | null, asOf)`, `feesDetector` (key fees, module fees, v1, rpc insight_src_fees). `finance.overdue_growth`: growth >= 25000 and growth% >= 25 (then=0 -> 100%); critical >=100 / warning >=50 / watch; confidence (count_now>=10 ? 0.7 : 0.5) + (>=50% ? 0.15 : 0); evidence Overdue now/4 weeks ago (unit ₹), Growth (%, 1 dp), Overdue invoices; date_from as_of-28. `finance.concession_spike`: base3 = max(3, base) = 3·base28 (integer math); fires recent>=5 and 3·recent>=2·base3; warning if recent>=base3; confidence 0.6 + (2·flagged>=recent ? 0.1 : 0); evidence Concessions (4 weeks), Usual per 4 weeks (1 dp), Hardship/other; date_from as_of-111.
`ADMISSION_STAGE_THRESHOLDS`, `AdmissionsSourceRow`, `detectAdmissions(rows, asOf)`, `admissionsDetector` (key admissions, module admissions, v1, rpc insight_src_admissions). Stale per stage = its own over_<t>; totals across stages; fires stale>=5 and 4·stale>=open; warning if stale>=20 or stale(enquiry.new)>=10; confidence 0.75; evidence top 4 stale stages (`<Stage> waiting > <t> days`, tie by stage key) + Open items. All three signals school-level (entity null), ISO-week window, titles verbatim.
Tests run: `pnpm test tests/unit/insights-detector-office.test.ts` -> RED first (module missing), then 26/26 passed; `pnpm lint` -> clean (whole repo); `pnpm typecheck` -> clean. Plain `node` import of both files (jobs:run runtime) -> loads and detects.
Tests not run and why: no DB tests (task: no DB commands; detectors are pure + fake-rpc tests).
Limitations / honesty label: none needed (real detections, no UI). Admissions dwell is an updated_at proxy (T22 debt row).
Security / integration risks: none new; titles/patterns/evidence hold counts, rupee totals and stage names only, no ids or names.
Follow-ups: T14 registers feesDetector/admissionsDetector in DETECTORS (Signals-table order).
New dependencies (justification): none
Assumptions made:
- SPEC CONFLICT: TEST FIRST says "Concessions 6 vs base 6 -> spike watch", but the ruling gives base28 = max(1, 6/3) = 2 and warning when recent >= 3·base28 = 6, so the ruling yields warning. Followed the ruling (formulas are the spec); test asserts warning for 6/6 and a separate 6 vs base 9 -> watch case. Owner to confirm.
- run() makes one rpc call without `.range()` paging: sources return 1 row (fees) / <=7 rows (admissions), far below max_rows (ruling says page; dead loop skipped).
- Money unit `₹` (matches fabric fixture units) for ruling's "INR"; pattern formats en-IN grouping.
- Growth/usual thresholds use exact or integer math; 1 dp rounding is display only.
- Admissions evidence lists only stages with stale > 0; date_from = as_of - 14 (longest stage threshold); stage display labels and all recommended_actions/patterns written by me.
- Unknown stage strings from the source are ignored.
