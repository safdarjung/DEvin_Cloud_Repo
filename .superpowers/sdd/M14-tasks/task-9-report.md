Packet: T-M14-T9 Acceptance over HTTP
Files changed: tests/db/lifecycle-acceptance.test.ts (new)
Behavior implemented: real route handlers (actions [name], query [name]) + bearer tokens,
  no RPC/fn shortcuts. Admin POST lifecycle.promote maps one section -> 200 counts, re-run
  -> 200 zeros; GET lifecycle.history -> completed+active rows. Admin POST lifecycle.withdraw
  on a portal-login student -> 200 {tcNo}; student's own token on people.getMyStudent -> 404;
  only-child guardian on people.listMyChildren -> 404; a second guardian with an active
  sibling (inline-created auth user, roles.ts style) stays 200 and reads the tcNo via
  lifecycle.history. Teacher POST lifecycle.withdraw -> 403 forbidden.
Tests run: pnpm test:db tests/db/lifecycle-acceptance.test.ts -> 1/1 pass; pnpm lint -> clean;
  pnpm typecheck -> clean (whole project, next typegen + tsc --noEmit, no errors).
Tests not run and why: full test:db / db:reset / db:types / seed (lane rule: own file only).
Limitations / honesty label: none (plain data path, no AI/simulated channel).
Security / integration risks: none introduced; exercises existing 0076 definers + RLS +
  getTenantContext's active-membership check over real HTTP, no new surface.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: "only-child guardian -> 404" read as people.listMyChildren (guardian
  analogue of getMyStudent); not specified verbatim in Task 9 text. Reused fixture's single
  guardian/student roles as the withdrawn child + only-child guardian; added one extra
  guardian auth user (deleted in `finally`) for the active-sibling case, since roles.ts's
  fixture provides one guardian per institution.
