Packet: M23-T19 Action `agent.start`

Files changed:
- src/modules/agents/actions.ts (edit: extracted `finishRun`, added `startAgentRun`)
- tests/db/agents-start-action.test.ts (new, 8 tests)
- tests/security/escalation.test.ts (+1 C-03 fixture `agent.start`)

Behavior implemented: found fully written by an earlier interrupted run;
verified against rulings and completed no further edits. `startAgentRun`
= `defineAction({ name: "agent.start", module: "agents",
schema: DecideAgentRunSchema.pick({ runId: true }), permission: "agent.run" })`.
Reads run (user client) -> not_found/invalid_state; `canDecideRun` with
`risk_class: "user_confirmed"` gates requester-or-approver -> forbidden;
disabled definition -> invalid_state; service-role conditional
`queued->running` claim, 0 rows -> conflict; `finishRun` (shared tail with
`agent.run`) runs the executor and persists outcome; audit `agent.start`
`{runId, slug, status}` only.

Tests run:
- `pnpm test:db tests/db/agents-start-action.test.ts` -> 8/8 passed
- `pnpm test:db tests/db/agents-run-action.test.ts` -> 9/9 passed (unchanged)
- `pnpm test:security tests/security/escalation.test.ts` -> 1522/1522 passed
- `pnpm test tests/unit/action-names-unique.test.ts` -> 6/6 passed
- `pnpm lint` -> 0 errors (8 pre-existing warnings in untouched
  tests/unit/mastery-schemas.test.ts)
- `pnpm typecheck` -> clean

Tests not run and why: none skipped from ACCEPT list.

Limitations / honesty label: none (no UI, T22 records honesty copy).

Security / integration risks: none found. Claim uses service-role
conditional update (`eq("status","queued")`) so concurrent starts race
safely; audit never includes task text (grepped in test).

Follow-ups: none new.

New dependencies (justification): none.

Assumptions made: none required; logic matched rulings verbatim on read.
