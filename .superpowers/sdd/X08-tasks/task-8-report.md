Packet: X08-T8 Survey queries
Files changed: src/modules/ptm/survey.queries.ts (new); src/modules/ptm/survey.query-defs.ts (new); tests/db/survey-queries.test.ts (new); src/app/api/v1/query/all-queries.ts (+1 import line); tests/db/api-query-route.test.ts (+3 sample inputs)
Behavior implemented: survey.list (survey.manage) — surveys + audiences, newest first, optional status filter. survey.results (survey.manage) — app.survey_results RPC, typed. survey.mine (survey.respond) — app.my_open_surveys RPC. All module: "ptm". SQL code:* errors from the two RPCs mapped via mapSqlError (mirrors src/modules/ptm/queries.ts's throwMapped), matching this lane's T6 pattern found on re-read.
Tests run: pnpm test:db tests/db/survey-queries.test.ts -> 5/5 pass. pnpm test:db tests/db/api-query-route.test.ts -> 7/7 pass (smoke, owner role). pnpm lint -> clean. pnpm typecheck -> clean.
Tests not run and why: no db:reset/full test:db (not DB owner, per lane rules).
Limitations / honesty label: none new; X08 feature stays "limited" (T11, not touched here).
Security / integration risks: none — read-only, RLS + existing definer checks (owner/principal/admin for list/results; survey_respondents/is_survey_recipient for mine) are the real boundary; no new write path.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: audience "newest first" = created_at desc (no explicit tiebreak given in rulings). Test fixtures used audience_type "school" (not "section") for the anonymous-suppression case since section-audience recipients are guardians only, not owner/principal/admissions.
