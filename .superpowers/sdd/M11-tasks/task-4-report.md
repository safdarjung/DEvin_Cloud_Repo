Packet: M11-T4 Question bank actions
Files changed: src/modules/question-bank/actions.ts (new), tests/db/question-bank-actions.test.ts (new), src/app/api/v1/actions/all-actions.ts (+1 import line), tests/security/escalation.test.ts (+3 C-03 fixtures)
Behavior implemented: questionBank.create/update/archive (permission question.manage), RLS 42501 -> forbidden, 0-row update -> not_found, archive flips is_active. Module field/requireModule skipped per Lane B ruling.
Tests run: pnpm test:db tests/db/question-bank-actions.test.ts -> 6/6 pass. pnpm test tests/unit/action-names-unique.test.ts -> 2 failed/2 passed (both failures: missing transport.* query registration, unrelated to this packet, concurrent WIP). pnpm test:security tests/security/escalation.test.ts -> 851/852 pass; 1 fail is registry-size walk (85 vs 90 defineAction calls) from other concurrent modules not yet wired into all-actions.ts, not from question_bank (its 3 fixtures pass). pnpm lint -> clean. pnpm typecheck -> clean for question-bank files; pre-existing errors only in untouched src/modules/lifecycle/actions.ts.
Tests not run and why: full db:reset/seed/db:types/test:db suite (lane rule: own test file only).
Limitations / honesty label: none (no UI, no simulated channel in this task).
Security / integration risks: none new; RLS already enforced by T2 migration, action layer adds no bypass.
Follow-ups: none from this task; action-names-unique and escalation registry-size failures belong to concurrent tasks (transport queries, unwired action files) — flag to controller, not mine to fix.
New dependencies (justification): none
Assumptions made: audit action strings use snake_case (question_bank.create/update/archive) per record_audit_event's dotted-lowercase check, distinct from the camelCase action/permission name questionBank.* used for registry/C-03.
