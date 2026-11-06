Packet: M24-T8 Docs
Files changed: docs/planning/coolskool/12-decision-log.md (new D47 ADR + seven DBT rows); docs/planning/coolskool/07-security-and-ai-governance.md (new bullet §5); docs/planning/fabric/03-roadmap-and-tracker.md (FB-AI-04, FB-AI-05 notes updated).
Behavior implemented: D47 ADR records M24's staff-assistant design (independent provider routing per ai_policy, not D28 extension; aggregate-only cloud catalog; curated over registry; draft-only createTask; code-built sources; text-only history). Added seven M24 "Not built" items to debt register (DBT-98..104): mastery.declineBySection, demo ai_unavailable on Vercel, missing RBAC roles, unverified aggregate flags, provider schema acceptance via live smoke, teacher draft tools scope, mapTenantContextError duplication. Section 5 bullet documents staff assistant rules (catalog split by aggregation, redaction, re-check at runtime, no write path, sources in metadata). Roadmap FB-AI-04/FB-AI-05 updated with test files and M24 context.
Tests run: pnpm lint → 0 errors (8 pre-existing warnings in mastery-schemas.test.ts, not touched).
Tests not run and why: docs only; no code or unit/integration tests.
Limitations / honesty label: none; documentation mirrors implemented M24 behavior (T1–T7 complete, code in place).
Security / integration risks: none; purely documentation of existing decisions and shortcomings.
Follow-ups: DBT-98..104 are resolved in later milestones (M25+) as noted in Trigger column.
New dependencies: none.
Assumptions made: seven "Not built" items from M24 rulings §3 are treated as equal-weight technical debt for future backlog prioritization.
