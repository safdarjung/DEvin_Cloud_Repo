Packet: M19-T7 Signal catalog + candidate contract
Files changed: src/modules/insights/signals.ts (new); tests/unit/insights-signals.test.ts (new)
Behavior implemented: SignalKey (11), DetectorKey (8), SIGNALS catalog (domain/kind/reviewerRole/approvalRequired?/why), InsightCandidate, makeCandidate (dedupe_key, approval_required, title/pattern slice, factors:[]), isoWeekKey, addDays, confidence, pct, SEVERITY_RANK, capPerSignal, DetectorInput/Detector. `import type` only, no value imports.
Tests run: `pnpm test tests/unit/insights-signals.test.ts` -> 11 passed (1 file); `pnpm lint` -> clean; `pnpm typecheck` -> clean.
Tests not run and why: none skipped; T7 has no DB/other deps (routing: T7 sonnet none []).
Limitations / honesty label: n/a (no DB rows, no UI).
Security / integration risks: none — type-only + pure functions, no I/O, no new deps.
Follow-ups: T8-T12 (detectors) import SignalKey/makeCandidate/Detector from this file; T14 imports Detector/capPerSignal.
New dependencies (justification): none
Assumptions made: `why` strings for each signal written by me (rulings leave wording to implementer, like recommended_actions); `SIGNALS` typed via explicit annotation in makeCandidate to read optional `approvalRequired` (satisfies narrows the const's own type, so an explicit widen was needed for tsc).
