# M17-T6: Docs — Backlog, security, features, testing, operations, debt

**Packet:** M17-T6 Resend email adapter documentation  
**Files changed:** 10  
**Behavior:** Updated planning docs with M17 completion: backlog note, security threat (T15 PII egress), definer note, feature matrix (F-COM-02/05), testing (C-31), operations (onboarding §13.5), decision log (DBT-52..56).  
**Tests run:** `pnpm lint` on modified .md files — no syntax errors  
**Tests not run and why:** Documentation only; no code tests apply  
**Limitations / honesty label:** T1–T5 reports do not exist yet (parallel tasks); debt entries (a–e) written from M17-T6 ruling directly  
**Security / integration risks:** None (documentation only; reflects approved rulings)  
**Follow-ups:** Debt tracking: DBT-52 (bounce tracking), DBT-53 (retry logic), DBT-54 (batch send for large schools), DBT-55 (invitation durability), DBT-56 (accept page UI — Workstream D)  
**New dependencies:** None  
**Assumptions:** No fabric roadmap row covers channels (grep found none); threat model §1 follows existing structure  

---

**Files touched:**  
- `docs/planning/coolskool/10-backlog-index.md` — §3 note: M17 no migration  
- `docs/planning/coolskool/07-security-and-ai-governance.md` — §1 threat T15 (PII egress), §4 M17 definer note  
- `docs/planning/coolskool/06-workflows-and-contracts.md` — §3 enrolment_welcome email channel live status  
- `docs/planning/coolskool/03-feature-matrix.md` — F-COM-02 (email impl live when key), F-COM-05 (badge per row)  
- `docs/planning/coolskool/08-testing-and-acceptance.md` — C-31 delivery status (sent/simulated/failed)  
- `docs/planning/coolskool/11-operations.md` — §13.5 Resend onboarding runbook  
- `docs/planning/coolskool/12-decision-log.md` — §Debt DBT-52..56 (webhooks, retry, batch, invitation, accept page)

