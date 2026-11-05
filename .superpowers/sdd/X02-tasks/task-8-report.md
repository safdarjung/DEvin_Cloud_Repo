Packet: X02-T8 Queries `certificates.list` + `certificates.printHtml`
Files changed: src/modules/certificates/queries.ts (new); src/modules/certificates/query-defs.ts (new); tests/db/certificates-queries.test.ts (new); src/app/api/v1/query/all-queries.ts (+1 import); tests/db/api-query-route.test.ts (+2 smoke samples)
Behavior implemented: `CertificateRow` + `listCertificates(ctx, filters)` (RLS + institution_id filter, optional studentId/serialNo/kind, order issued_at desc, limit); display fields read from the row's frozen `snapshot` jsonb, not a live join. `certificateHtml(ctx, id)` → `{html}` via `renderCertificateHtml`, `null` if not visible, `AppError("internal")` if snapshot fails `CertificateSnapshotSchema`. Defs `certificates.list`/`certificates.printHtml`, permission `certificate.manage`, module `certificates`.
No partial run found for this task (queries.ts/query-defs.ts/test file did not exist); started clean.
Tests run: `pnpm test:db tests/db/certificates-queries.test.ts` → 1 file, 6/6 passed. `pnpm test:db tests/db/api-query-route.test.ts` → 1 file, 7/7 passed (owner smoke incl. both new queries + concurrent lane's exam-seating ones). `pnpm lint` → clean. `pnpm typecheck` → clean.
Tests not run and why: full `test:security`/`test:db` suites — not DB owner, brief restricts to single-file runs.
Limitations / honesty label: none new (printing honesty label is T12).
Security / integration risks: none new; RLS is the real filter, institution_id/id checks are defense in depth matching every other queries.ts.
Follow-ups: none for T8. T9 (idCardsHtml) and T10 (HTTP acceptance) build on these defs.
New dependencies (justification): none
Assumptions made: `issued_by_name` in the snapshot schema is non-nullable (rulings), so my db test names the issuing actor's profile before printHtml (fixture users have no auth metadata → null full_name by default) — not a code change, test fixture only.
Other-lane files touched concurrently in shared registries during this run (not mine): all-actions.ts, escalation.test.ts, grants.test.ts, catalog.ts, permissions.ts, types.ts, core/schemas.ts, html.ts, 07-security-and-ai-governance.md — all additive, no conflict observed.
