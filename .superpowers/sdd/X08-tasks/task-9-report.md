Packet: X08-T9 Acceptance over HTTP + module gate
Files changed: tests/db/ptm-acceptance.test.ts (new)
Behavior implemented: one HTTP-dispatch acceptance test (real POST/[name] + GET query routes, real bearer tokens, real RLS) covering: admin creates+publishes a 2-section PTM event; teacher `ptm.slots.add` 10:00-10:30 -> 3 slots; guardian `ptm.forStudent` shows 3 open; G1 books (200); G2 (second family, newFamily helper) books same slot -> 409 conflict; G1 books a second slot same teacher/child -> 409 conflict; `ptm.teacherSchedule` shows the booked child; G1 cancels -> slot open again; admin `survey.create` (anonymous default, section audience); G1 `survey.mine` lists it; respond -> 200, again -> 409 conflict; admin `survey.results` -> suppressed:true (1 response); G1 `survey.results` -> 403 forbidden (no survey.manage); owner `core.module.set {key:"ptm",enabled:false}` -> G1 `ptm.booking.create` and `survey.mine` -> 403 forbidden (MOD gate, module check precedes schema/permission); re-enabled.
Tests run: `pnpm test:db tests/db/ptm-acceptance.test.ts` -> 1 file, 1 passed (ran twice, stable). `pnpm lint` -> clean, exit 0. `pnpm typecheck` -> clean, exit 0.
Tests not run and why: none skipped; task names only this one file.
Limitations / honesty label: none new (X08 honesty label is T11's job, untouched here).
Security / integration risks: none identified; reused existing actions/queries/RLS/definers from T2/T3/T5/T6/T7/T8 as-is, no new SQL or app code.
Follow-ups: none for T9. T10 (seed) / T11 (docs) still pending per header routing.
New dependencies (justification): none.
Assumptions made: G2 fixture built inline (not exported from ptm-rls.test.ts), same shape as that file's local `newFamily` helper — reuse-by-copy since the helper isn't exported. Survey audience used "section" (not "school") to match the PTM section fixture directly.
