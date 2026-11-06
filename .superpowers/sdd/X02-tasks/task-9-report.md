Packet: X02-T9 Query `certificates.idCardsHtml`
Files changed: src/modules/certificates/id-cards.queries.ts (new); src/modules/certificates/query-defs.ts (+1 export); tests/db/certificates-id-cards.test.ts (new); tests/db/api-query-route.test.ts (+1 smoke sample)
Behavior implemented: `ID_CARD_MAX=60`, `ID_CARD_PHOTO_MAX_BYTES=51200`. `idCardsHtml(ctx, classSectionId)` -> `{html}|null`: section+grade+year lookup (null if not visible); active enrolments ordered roll_no asc nulls-last then first_name, capped at 60; guardian phone (primary else earliest linked); newest active photo doc per student (image/jpeg|png, size<=cap) downloaded with the caller's own client and base64-embedded, oversize/missing -> placeholder + "photos over 50 KB" footer counter. Def `certificates.idCardsHtml` (`IdCardsSchema`, `certificate.manage`, module `certificates`), wired through existing `all-queries.ts` import.
No partial run found for T9 (id-cards.queries.ts/test did not exist); started clean.
Tests run: `pnpm test:db tests/db/certificates-id-cards.test.ts` -> 1 file, 5/5 passed (3 cards+phones+withdrawn-absent; photo embed + placeholder; oversize->footer; cross-tenant null; teacher forbidden). `pnpm test:db tests/db/api-query-route.test.ts` -> 1 file, 7/7 passed (owner smoke incl. new query). `pnpm lint` clean. `pnpm typecheck` clean.
Tests not run and why: full `test:security`/`test:db` — not DB owner, brief restricts to single-file runs.
Limitations / honesty label: none new (print honesty label is T12); no issue record/serial/audit for ID cards per rulings (debt, already noted in packet).
Security / integration risks: none new; RLS is the real filter on every table touched; storage download uses caller's client only, size gate applied before download.
Follow-ups: none for T9. T10 (HTTP acceptance) exercises this over `?format=html`.
New dependencies (justification): none
Assumptions made: tie-break ordering (roll_no then first_name) applied client-side after the capped DB fetch, matching the single-`order()`-by-roll_no precedent in attendance/exams/academics queries.ts rather than an embedded-table order clause (not supported cleanly by postgrest-js for this shape).
Other-lane files touched concurrently in shared registries during this run (not mine): none observed for this task (query-defs.ts and all-queries.ts import line were already wired by T8).
