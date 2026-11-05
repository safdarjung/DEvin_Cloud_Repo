Packet: X03-T6 Circulation actions
Files changed:
- `src/modules/library/circulation.actions.ts` (new)
- `tests/db/library-circulation-actions.test.ts` (new, 8 tests)
- `src/app/api/v1/actions/all-actions.ts` (+1 import line)
- `tests/security/escalation.test.ts` (+3 C-03 fixtures)
Behavior implemented: `issueLoan`/`renewLoan`/`returnLoan` (module `library`, permission `library.manage`); accession -> row in ctx.institution (else not_found) -> `rpc("issue_library_loan"/"renew_library_loan"/"return_library_loan")`; no TS audit (RPCs audit). returnLoan `fineCharged` = `invoice_line_id !== null`.
Tests run:
- `pnpm test:db tests/db/library-circulation-actions.test.ts` -> 8 passed
- `pnpm test tests/unit/action-names-unique.test.ts` -> 6 passed
- `pnpm test:security tests/security/escalation.test.ts` -> 1172 passed
- `pnpm lint && pnpm typecheck` -> clean
Tests not run and why: full `pnpm test:security` (non-owner; ran escalation.test.ts only per lane rules).
Limitations / honesty label: none; no UI this milestone.
Security / integration risks: none new; accession lookup scoped to ctx.institution before any RPC call (never leaks another institution's row).
Follow-ups: T9 HTTP acceptance exercises these three actions end-to-end.
New dependencies: none.
Assumptions made: `rpc` arg types reject `null` for optional uuid params (TS2322) — pass `input.studentId`/`staffId` (`string | undefined`) directly, not `?? null`. Conflict test reuses same studentId for 2nd issue (RPC checks "copy on loan" before any borrower rule, per 0086). Two db tests needed explicit 20000ms timeouts (DBT-46 auth-under-load pattern, same as T2/T3); applied to all 8 for consistency.
