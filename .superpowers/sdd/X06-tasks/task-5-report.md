Packet: X06-T5 Action `examSeating.generate`

Files changed:
- `src/modules/exam-seating/actions.ts` (new)
- `tests/db/exam-seating-actions.test.ts` (new)
- `src/app/api/v1/actions/all-actions.ts` (+1 import line)
- `tests/security/escalation.test.ts` (+1 C-03 fixture entry)

Behavior implemented: `generateSeatingPlan = defineAction({ name: "examSeating.generate", module: "exam_seating", schema: GenerateSeatingSchema, permission: "exam.manage", handler })`. Thin wrapper over T3's `generate_seating_plan` RPC (`p_institution_id: ctx.institution.id`, rooms mapped `roomId→room_id`, `seats` passed only if given); RPC errors through `mapSqlError`/`AppError` (timetable/actions.ts `throwMapped` pattern); returns `{ planId, versionNo, seatCount }`. No TS audit (RPC audits).

Tests run: `pnpm test:db tests/db/exam-seating-actions.test.ts` → 5/5 pass (happy path v1→v2, module-off forbidden + no plan row, admin forbidden, too-few-seats conflict, started-slot invalid_state). `pnpm test tests/unit/action-names-unique.test.ts` → 6/6 pass. `pnpm test:security tests/security/escalation.test.ts tests/security/module-gate.test.ts` → 1306/1306 pass. `pnpm lint` clean.

Tests not run and why: full `pnpm typecheck` — pre-existing errors in `src/modules/certificates/actions.ts` (lines 50–51, other packet, concurrent edit mid-run); `exam-seating/actions.ts` and this test file are clean (checked via targeted tsc output filter).

Limitations / honesty label: n/a (backend action only, no UI).

Security / integration risks: none new — all authorization/validation is T3's definer; this layer only maps errors and gates the module.

Follow-ups: T6 (queries), T8 (HTML query wrappers), T9 (route smoke).

New dependencies: none.

Assumptions made: none; rulings followed verbatim (error mapping, no audit, fixture shape).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
