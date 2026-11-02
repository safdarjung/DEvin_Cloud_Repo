Packet: T-M17-T3 core.member.invite sends invite email
Files changed: src/modules/core/actions.ts (inviteMember handler + buildInviteEmailText helper); tests/db/member-invite-actions.test.ts (extended)
Behavior implemented: inviteMember sends via emailChannel() only when resendConfigured() && APP_URL set; link = `${APP_URL}/invite#token=<token>`; Idempotency-Key `invite:<id>`; result/audit `delivery: sent|simulated|failed`, no address in audit. Send failure never fails action.
Tests run: pnpm test:db tests/db/member-invite-actions.test.ts -> 9/9 pass; pnpm test:db tests/db/onboarding-journey.test.ts -> 1/1 pass; pnpm test:security tests/security/escalation.test.ts -> 692/692 pass; pnpm lint (touched files) -> clean; pnpm typecheck -> clean.
Tests not run and why: full test/test:db/test:security suites (brief: own files only).
Limitations / honesty label: no badge/UI change needed (result field only); invite emails not in delivery_attempts (ruling, debt item d).
Security / integration risks: none new — reused T1's resendEmail/emailChannel; no new permission/ErrorCode/RLS.
Follow-ups: none beyond rulings' named debt (T6 docs).
New dependencies (justification): none.
Assumptions made: subject line "You're invited to <school>" (not specified by rulings, no test asserts subject for invite).
