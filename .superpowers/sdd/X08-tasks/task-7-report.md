Packet: X08-T7 Survey actions
Files changed: src/modules/ptm/survey.actions.ts (new); tests/db/survey-actions.test.ts (new); src/app/api/v1/actions/all-actions.ts (+1 import); tests/security/escalation.test.ts (+3 C-03 fixtures)
Behavior implemented: survey.create (draft insert -> audiences insert -> status=open update; any failure deletes the draft; closesAt window (now, now+90d] else validation_failed; audit survey.created with questionCount/audienceCount/isAnonymous); survey.close (update status=closed; 0 rows -> not_found; audit survey.closed same fields, read back); survey.respond (RPC submit_survey_response -> {surveyId}, no audit per ruling). Write-path error mapping per Task 7 ruling: 42501->forbidden, 23503->not_found, 23514->validation_failed; RPC `code:*` via mapSqlError.
Tests run: `pnpm test:db tests/db/survey-actions.test.ts` -> 1 file, 5 passed; `pnpm test tests/unit/action-names-unique.test.ts` -> 6 passed; `pnpm lint` clean (2 pre-existing warnings in T8's survey-queries.test.ts, not mine); `pnpm typecheck` clean.
Tests not run and why: none skipped.
Limitations / honesty label: none new (X08 honesty label is T11's job).
Security / integration risks: `pnpm test:security tests/security/escalation.test.ts` -> 1213 passed, 9 failed, all under fixture "ptm.event.create" (T5's file, concurrently landed, unrelated to survey.*) — not my FILES, left as-is per brief; all survey.create/close/respond fixtures pass cleanly.
Follow-ups: flag the ptm.event.create escalation fixture failure to T5's owner/T9.
New dependencies (justification): none
Assumptions made: close's audit fields mirror create's (id, questionCount, audienceCount, isAnonymous) — ruling's parenthetical read as applying to both create and close.
