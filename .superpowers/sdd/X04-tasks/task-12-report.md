Packet: X04-T12 Docs

Files changed: docs/planning/coolskool/03-feature-matrix.md, 05-data-architecture.md, 06-workflows-and-contracts.md, 07-security-and-ai-governance.md, 10-backlog-index.md, 11-operations.md, 12-decision-log.md

Behavior implemented: Documentation for X04 late fees + instalment plans (T1–T11 complete):
- F-FIN-10 feature matrix row: status changed from planned to limited; description detailed (flat/per-day, grace, cap, nightly); owner fee-plans; acceptance test recorded
- Data architecture: three new tables (late_fee_rules, invoice_instalments, late_fee_charges) added to §2.6 finance section; fee-plans ownership row added to §3
- Workflows: W9 (Fee structure flow) enhanced with late-fee semantics, instalment priority, principal-first waterfall, payment allocation, plan constraints; audit entries added (fee_plans.late_fee_rule.upserted, fee_plans.instalments.set); job fee_plans.late_fees documented in §7
- Security: 07 §4 comprehensive row for 0087 definers (set_invoice_instalments, apply_late_fees, enqueue_due_late_fees, app.invoice_principal) + invokers (invoice_instalment_status, ledger_voucher_lines) + reuse of X03's app.add_invoice_charge
- Backlog: 0087 marked built in 10-backlog-index §3 with task reference
- Operations: 11 §5 updated with late-fees sweep description (nightly rule → one job per institution per day, idempotent, module-gated in TS not SQL, charges immutable)
- Debt: 12 §3 eight new rows (DBT-86..93) capturing skipped X04 features (waiver/reversal, plan removal after fees, per-school rule override, year-spanning plans, parent notification, manual apply, demo-only timing, Tally unvalidated, seed-rule stagger for named students)

Tests run: `pnpm lint` → 0 errors, 8 pre-existing warnings (untouched tests/unit/mastery-schemas.test.ts). `pnpm typecheck` → clean for all touched docs (no code).

Tests not run and why: No code changes; docs-only packet per task scope. Markdown format validated in-editor; spell-checked against existing terminology.

Limitations / honesty label: Docs only. No code changed, no new files added beyond the report. Tally layout honesty note already embedded in feature matrix and debt rows.

Security / integration risks: None. Documentation-only changes cannot introduce bugs or regressions; docs reflect T1–T11 SQL/TS/job code already landed.

Follow-ups: None new from T12 scope (all debt rows recorded in 12-decision-log.md).

New dependencies: None.

Assumptions made: T1–T11 tasks already merged and complete (read from reports in .superpowers/sdd/X04-tasks/). Spec values (table names, permission names, job types, audit action names) taken verbatim from X04-tasks.md rulings.
