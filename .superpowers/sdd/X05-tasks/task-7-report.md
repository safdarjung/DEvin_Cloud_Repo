Packet: X05-T7 Docs

Files changed: docs/planning/coolskool/03-feature-matrix.md (F-COM-04 row), 10-backlog-index.md (0089 status), 07-security-and-ai-governance.md (T16 threat row, X05 definer line), 06-workflows-and-contracts.md (channel cells for 4 notification types), 11-operations.md (§13.7 WhatsApp runbook), 12-decision-log.md (DBT-81..86 debt entries), 05-data-architecture.md (§8.1 notifications entities)

Behavior implemented: F-COM-04 updated to reflect X05 demo status (sim) and live condition (when MSG91 env set). 0089 migration marked built (T1-T6 complete). T16 threat row added: PII egress to WhatsApp BSP via MSG91, with controls (module off when unconfigured, demo always simulated, no secrets/phones/response in error logs). X05 definer line added to §4 (no new definer; app.module_catalog insert for whatsapp). Four notification type rows (attendance_absence, results_published, recheck_decided, fee_reminder) now list whatsapp channel after sms. §13.7 WhatsApp runbook: WABA setup, template submission to Meta via MSG91, env vars (`MSG91_AUTH_KEY`, `MSG91_WA_NUMBER`, `MSG91_WA_NAMESPACE` optional), module enable, opt-in collection, test flow, troubleshooting (no_contact, invalid_phone, no_template, provider errors). Six debt rows DBT-81..86: deployment-wide sender, no delivery/read receipts, no consent record, language always en, no failed retry, no batching via bulk to array.

Tests run: pnpm lint (docs only, no code changes)

Tests not run and why: no code touched; no test commands applicable to documentation updates

Limitations / honesty label: none new; documentation reflects exactly what T1-T6 built

Security / integration risks: none new; threat row (T16) and definer line (X05) are non-code documentation entries reflecting existing implementation. No API/DB changes documented here.

Follow-ups: Debt entries (DBT-81..86) are known limitations for Phase 2; no immediate action needed for Phase 1 demo.

New dependencies (justification): none

Assumptions made: T1-T6 implementation matches the rulings and task specifications exactly; no gaps in the built code beyond the documented debt entries.
