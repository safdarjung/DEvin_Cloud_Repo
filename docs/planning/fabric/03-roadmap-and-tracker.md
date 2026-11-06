# 03 — Fabric roadmap and feature tracker

Status: Phase 0 (2026-10-31). One row per `01-master-prd.md` feature id. `03-feature-matrix.md` acceptance text is not restated for `FB-EDU-*`; see the PRD row.

## Phase definitions

- **Phase 0** (done when `PLAN` is posted): merge to `main`, wave-0 fixes, contracts, fixtures, store, Canvas spec, Laya router, React Flow wrapper, nav + placeholders, docs. Delivered as backend packets `F-BE-01,03,05..16,18..21`.
- **Phase 1** (UI session, `04-ui-packets/F-UI-nn.md`): `F-UI-01 → 16`, backend reviews each `DONE`.
- **Phase 2** (backend session, after UI accepted): migrations `20261028000052–0063` with RLS, queries/actions behind the same function names, AI via `src/lib/ai/gateway.ts` only, seed, security suite. Backend rows numbered `F-BE-24+`. Badges move Simulated → Limited per this tracker.

**UI packet order:** `01→02→07→08→09→11→10→12→13→03→04→05→06→14→15→16`.

**Packet name key:** Command centre→F-UI-02 · Learning→03 · Student success→04 · Operations→05 · Finance intel→06 · Insights→07 · Simulator→08 · Twin→09 · AI workforce→10 · Marketplace→11 · Studio→12 · Personal AI→13 · Data→14 · Trust→15 · polish→16. `F-UI-01` is the base shell/nav (delivered early as `F-BE-21`).

**Priority:** P1 = Phase 1 UI showcase · P2 = Phase 2 backend · P3 = later stages (vision §21).
**Status:** `planned` default. `simulated` only where a Phase 0 packet already shipped it: Canvas spec (`F-BE-03`), Laya routing (`F-BE-19`), nav (`F-BE-21`), and the 14 workspace fixtures (`F-BE-05..16,18`).
**Release phase** = vision §21 stage 1–12, or `ongoing` for cross-cutting trust/security.

## CORE

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-CORE-01 | all | P2 | FB-ID-01 | planned | F-BE-24+ | — | tenant isolation (rule 1) | 2 |
| FB-CORE-02 | all | P2 | FB-AI-01, FB-AGT-01 | planned | F-BE-24+ | — | ai gateway boundary (rule 6) | 2 |
| FB-CORE-03 | all | P2 | FB-MEM-01, FB-DATA-03 | planned | F-BE-24+ | — | own-rows RLS reused across packs | 2 |
| FB-CORE-04 | owner, principal, admin | P2 | FB-AGT-02 | limited | F-BE-24+ | — | tenant isolation, append-only runs | 2 |
| FB-CORE-05 | staff | P1 | FB-INT-01..06 | simulated | F-BE-03 | tests/unit/fabric-spec.test.ts | no model emits HTML; action payloads capped (ADR D36) | 2 |
| FB-CORE-06 | all | P2 | — | planned | F-BE-24+ | — | audit append-only (rule 5) | 2 |
| FB-CORE-07 | owner, platform admin | P2 | FB-MKT-04 | planned | F-BE-24+ | — | platform-admin write only | 2 |
| FB-CORE-08 | owner, admin, platform admin | P2 | FB-TRUST-01, FB-TRUST-05 | planned | F-BE-24+ | — | audit_events append-only, never updated | 2 |
| FB-CORE-09 | owner, platform admin | P2 | FB-COM-01 | planned | F-BE-24+ | — | billing data restricted sensitivity | 2 |
| FB-CORE-10 | platform admin | P2 | — | planned | M01 (actions API), M02 (query API) | tests/db/api-actions-route.test.ts, tests/db/api-query-route.test.ts | stable API surface, no cross-module table reads | 2 |
| FB-CORE-11 | platform admin | P3 | FB-CORE-01..10 | planned | future pack | — | new pack inherits Core RLS pattern | 10 |
| FB-CORE-12 | owner, platform admin | P3 | FB-MKT-01..06 | planned | future pack | — | install-status trigger gated | 10 |

## ID

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-ID-01 | all | P2 | FB-CORE-01 | planned | F-BE-24+ | — | RLS + requirePermission (rule 2) | 2 |
| FB-ID-02 | all | P2 | FB-MEM-01 | planned | F-BE-24+ | — | personal rows carry no institution_id | 2 |
| FB-ID-03 | all | P2 | FB-ID-02 | planned | F-BE-24+ | — | definer fn clears share flag, never copies rows | 2 |
| FB-ID-04 | owner, admin | P2 | FB-CORE-01 | planned | F-BE-24+ | — | requirePermission in every action (rule 2) | 2 |
| FB-ID-05 | owner, admin | P2 | FB-ID-04, FB-TRUST-01 | planned | F-BE-24+ | — | audit_events record every grant/revoke | 2 |

## AI

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-AI-01 | platform admin | P2 | FB-CORE-02 | planned | F-BE-24+ | — | single gateway entry point (rule 6) | 3 |
| FB-AI-02 | owner, admin | P1 | FB-AI-01 | simulated | F-BE-19 | tests/unit/fabric-router.test.ts | localhost-only bridge, any failure → null, never 5xx | 3 |
| FB-AI-03 | owner, admin | P2 | FB-AI-02 | planned | F-BE-24+ | — | tests/security/* verifies restricted data never reaches cloud | 3 |
| FB-AI-04 | all | P2 | FB-AI-01 | limited | F-BE-24+ | `tests/unit/assistant-tools.test.ts`, `tests/db/assistant-acceptance.test.ts` | ai gateway redaction + quota (rule 6); staff assistant M24: tool offered only when the permission is held and the module is on; the query re-checks | 3 |
| FB-AI-05 | owner, principal, admin | P2 | FB-AGT-01, FB-AGT-02 | limited | F-BE-24+ | `tests/unit/assistant-tools.test.ts`, `tests/db/assistant-acceptance.test.ts` | tool call checked against caller permission; every async query in the tool calls `guardedCall` for re-check | 3 |

## MEM

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-MEM-01 | all | P2 | FB-ID-02 | planned | F-BE-24+ | tests/unit/fabric-fixtures/personal.test.ts | own-rows RLS only, no institution_id | 3 |
| FB-MEM-02 | staff | P2 | FB-ID-04 | planned | F-BE-24+ | — | role-gated retrieval via owner module queries | 3 |
| FB-MEM-03 | all | P2 | FB-MEM-01 | planned | F-BE-24+ | tests/unit/fabric-fixtures/personal.test.ts | no training on private conversation content | 3 |
| FB-MEM-04 | platform admin | P2 | FB-AI-02 | planned | F-BE-24+ | — | disabled by default; explicit consent record required | 3 |
| FB-MEM-05 | platform admin | P2 | FB-MEM-01, FB-TRUST-03 | planned | F-BE-24+ | — | opt-in consent row required before any shared training use | 3 |

## AGT

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-AGT-01 | owner, principal, admin | P1 | FB-ID-04, FB-AI-01 | simulated | F-UI-10 | tests/unit/fabric-fixtures/agents.test.ts | catalog + code compute risk_class, DB constraint enforced, local AI only (DBT-90) | 5 |
| FB-AGT-02 | owner, principal, admin | P1 | FB-CORE-04 | simulated | F-UI-10 | tests/unit/flow-from-spec.test.ts | version bump on edit, runs append-only | 5 |
| FB-AGT-03 | owner, principal, admin | P1 | FB-AGT-01 | simulated | F-UI-10 | tests/unit/fabric-fixtures/agents.test.ts | cost/error data read-restricted to owner/principal/admin | 5 |
| FB-AGT-04 | owner, principal, admin | P1 | FB-AGT-01 | simulated | F-UI-10 | tests/unit/fabric-fixtures/agents.test.ts | human_approved runs block on `agent.approve` action via registry; state machine enforced by guard | 5 |

## DATA

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-DATA-01 | platform admin, owner | P1 | FB-CORE-01 | simulated | F-UI-14 | tests/unit/fabric-fixtures/data.test.ts | dedup/quality checks before write | 3 |
| FB-DATA-02 | owner, admin | P1 | FB-ID-04 | simulated | F-UI-14 | tests/unit/fabric-fixtures/data.test.ts | connector secrets vault-ref only, never in rows | 3 |
| FB-DATA-03 | all (permission-aware) | P1 | FB-MEM-01, FB-MEM-02 | simulated | F-UI-14 | tests/unit/fabric-fixtures/data.test.ts | permission-aware retrieval, source reference required | 3 |

## INT

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-INT-01 | staff | P1 | FB-CORE-05 | simulated | F-UI-07 | tests/unit/fabric-fixtures/insights.test.ts | read-only derived view, RLS via owner tables | 4 |
| FB-INT-02 | staff | P1 | FB-INT-01 | simulated | F-UI-07 | tests/unit/fabric-fixtures/insights.test.ts | evidence vs hypothesis fields kept distinct | 4 |
| FB-INT-03 | staff | P1 | FB-INT-01 | simulated | F-UI-07 | tests/unit/fabric-fixtures/insights.test.ts | confidence range mandatory on every forecast | 4 |
| FB-INT-04 | staff, owner, principal | P1 | FB-INT-03 | simulated | F-UI-07 | tests/unit/fabric-fixtures/insights.test.ts | insight_actions append-only, outcome via new row | 4 |
| FB-INT-05 | owner, principal | P1 | FB-INT-03 | simulated | F-UI-08 | tests/unit/fabric-simulator.test.ts | scenario approval requires approver ≠ creator | 9 |
| FB-INT-06 | owner, principal | P1 | FB-INT-04 | simulated | F-UI-07 | tests/unit/fabric-fixtures/insights.test.ts | measured outcome via new row, never overwrite | 4 |
| FB-INT-07 | owner, principal | P2 | FB-INT-04, FB-AGT-02 | limited | M23 backend | tests/db/workflows-acceptance.test.ts | low-risk deterministic automation: in-app alerts, reports, queued agent tasks; family reminders need approval (`<LimitedBadge>`) | 6 |

## TWIN

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-TWIN-01 | staff | P1 | FB-DATA-01, FB-INT-01 | simulated | F-UI-09 | tests/unit/fabric-fixtures/twin.test.ts | job-runner (service role) writes snapshots only | 9 |
| FB-TWIN-02 | all | P1 | FB-MEM-01 | simulated | F-UI-09 | tests/unit/fabric-fixtures/twin.test.ts | own-rows RLS, no institution_id | 9 |
| FB-TWIN-03 | staff | P1 | FB-TWIN-01, FB-INT-05 | simulated | F-UI-09 | tests/unit/flow-from-spec.test.ts | graph ≤80 nodes (data model cap) | 9 |
| FB-TWIN-04 | owner, principal | P1 | FB-TWIN-01, FB-INT-05 | simulated | F-UI-09 | tests/unit/fabric-fixtures/twin.test.ts | scenario state separate from historical/current | 9 |

## MKT

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-MKT-01 | all | P1 | FB-CORE-11 | simulated | F-UI-11 | tests/unit/fabric-fixtures/marketplace.test.ts | catalog is global/read-only to members | 6 |
| FB-MKT-02 | all | P1 | FB-MKT-01 | simulated | F-UI-11 | tests/unit/fabric-fixtures/marketplace.test.ts | filter results scoped to catalog, no cross-tenant leak | 6 |
| FB-MKT-03 | owner, admin | P1 | FB-MKT-01 | simulated | F-UI-11 | tests/unit/fabric-fixtures/marketplace.test.ts | required_permissions shown before install offered | 6 |
| FB-MKT-04 | owner, admin | P1 | FB-MKT-01 | simulated | F-UI-11 | tests/unit/fabric-fixtures/marketplace.test.ts | install-status trigger enforces state machine | 6 |
| FB-MKT-05 | owner, platform admin | P2 | FB-MKT-01, FB-COM-04 | planned | F-BE-24+ | tests/unit/fabric-fixtures/marketplace.test.ts | entitlement check before paid install completes | 6 |
| FB-MKT-06 | platform admin | P3 | FB-MKT-01, FB-STU-07 | planned | future pack | — | vendor + confidentiality terms recorded pre-listing | 10 |

## STU

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-STU-01 | owner, principal | P1 | FB-AI-04 | simulated | F-UI-12 | tests/unit/fabric-fixtures/studio.test.ts | intake required-fields gate | 7 |
| FB-STU-02 | platform admin | P1 | FB-STU-01, FB-AI-01 | simulated | F-UI-12 | tests/unit/fabric-fixtures/studio.test.ts | cheapest-resolution-path ordering enforced | 7 |
| FB-STU-03 | owner, principal | P1 | FB-STU-02 | simulated | F-UI-12 | tests/unit/fabric-fixtures/studio.test.ts | proposals versioned, never overwritten | 7 |
| FB-STU-04 | platform admin | P2 | FB-STU-03, FB-AGT-01 | planned | F-BE-24+ | tests/unit/fabric-fixtures/studio.test.ts | isolated branch/worktree, never against main | 7 |
| FB-STU-05 | owner, principal, platform admin | P2 | FB-STU-04, FB-TRUST-01 | planned | F-BE-24+ | — | human engineering-review approval required pre-deploy | 7 |
| FB-STU-06 | owner, principal | P1 | FB-STU-01..05 | simulated | F-UI-12 | tests/unit/fabric-fixtures/studio.test.ts | preview_html platform-admin-written only, no scripts | 7 |
| FB-STU-07 | platform admin | P2 | FB-STU-04 | planned | F-BE-24+ | — | module gets own directory + owner, no inline customer code | 7 |

## EDU

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-EDU-01 | admissions, principal, guardian | P1 | matrix §C | planned | coolskool (non-fabric) | see matrix §C | per coolskool rules 1–5 | 1 |
| FB-EDU-02 | admin, principal, teacher | P1 | matrix §B | planned | coolskool (non-fabric) | see matrix §B | per coolskool rules 1–5 | 1 |
| FB-EDU-03 | admin, guardian | P1 | matrix §B | planned | coolskool (non-fabric) | see matrix §B | per coolskool rules 1–5 | 1 |
| FB-EDU-04 | admin, principal | P1 | matrix §E | planned | coolskool (non-fabric) | see matrix §E | per coolskool rules 1–5 | 1 |
| FB-EDU-05 | teacher, admin, principal | P1 | matrix §D | planned | coolskool (non-fabric) | see matrix §D | per coolskool rules 1–5 | 1 |
| FB-EDU-06 | teacher, admin | P1 | matrix §D | planned | coolskool (non-fabric), M10 (backend) | see matrix §D | per coolskool rules 1–5 | 1 |
| FB-EDU-07 | admin, teacher, principal | P1 | matrix §D | planned | coolskool (non-fabric) | see matrix §D | per coolskool rules 1–5 | 1 |
| FB-EDU-08 | teacher, student, guardian | P1 | matrix §D | live | coolskool (non-fabric) | see matrix §D | per coolskool rules 1–5 | 1 |
| FB-EDU-09 | exam_controller, teacher | P1 | matrix §D | planned | coolskool (non-fabric) | see matrix §D | immutable results/marks (rule 5) | 1 |
| FB-EDU-10 | teacher, principal | P1 | matrix §F | limited | coolskool (non-fabric) | see matrix §F | per coolskool rules 1–5 | 1 |
| FB-EDU-11 | teacher, principal, guardian | P1 | matrix §B | planned | coolskool (non-fabric) | — | AI signal only, human review required (vision §11.11) | 1 |
| FB-EDU-12 | admin, teacher, guardian | P1 | matrix §C | planned | coolskool (non-fabric) | see matrix §C | per coolskool rules 1–5 | 1 |
| FB-EDU-13 | accountant, guardian, principal | P1 | matrix §E | planned | coolskool (non-fabric) | see matrix §E | immutable payments/receipts (rule 5) | 1 |
| FB-EDU-14 | admin, principal | P1 | matrix §G | planned | coolskool (non-fabric) | see matrix §G | per coolskool rules 1–5 | 1 |
| FB-EDU-15 | admin, guardian | P1 | matrix §G | planned | coolskool (non-fabric) | see matrix §G | per coolskool rules 1–5 | 1 |
| FB-EDU-16 | owner, principal, admin | P1 | matrix §A, §H | planned | coolskool (non-fabric) | see matrix §A/§H | per coolskool rules 1–5 | 1 |

## DASH

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-DASH-01 | principal | P1 | FB-CORE-05, FB-INT-04 | planned | F-UI-02 | — | dashboard_layouts own-rows RLS | 4 |
| FB-DASH-02 | teacher | P1 | FB-DASH-01 | planned | F-UI-02 | — | dashboard_layouts own-rows RLS | 4 |
| FB-DASH-03 | guardian | P1 | FB-DASH-01 | planned | F-UI-02 | — | guardian sees only own linked children | 4 |
| FB-DASH-04 | student | P1 | FB-DASH-01 | planned | F-UI-02 | — | restricted fields hidden for student role | 4 |
| FB-DASH-05 | admissions, accountant, exam_controller, admin | P1 | FB-DASH-01 | planned | F-UI-02 | — | widget set gated per role permission | 4 |
| FB-DASH-06 | staff | P1 | FB-DASH-01 | planned | F-UI-16 | — | widget-level permission checks | 4 |
| FB-DASH-07 | all | P1 | FB-DASH-01, FB-DASH-06 | planned | F-UI-16 | — | dashboard_layouts own-rows RLS | 4 |

## WS

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-WS-01 | owner, principal | P1 | FB-DASH-01 | simulated | F-UI-02 | tests/unit/fabric-fixtures/command.test.ts | dashboard scoped to caller's institution | 4 |
| FB-WS-02 | teacher, principal | P1 | FB-EDU-06, FB-EDU-09, FB-EDU-10 | simulated | F-UI-03 + M10 (backend) | tests/unit/fabric-fixtures/learning.test.ts, tests/db/curriculum-rls.test.ts, tests/db/curriculum-actions.test.ts, tests/db/curriculum-queries.test.ts, tests/db/curriculum-acceptance.test.ts | read-only derived from owner module tables | 4 |
| FB-WS-03 | teacher, principal, guardian | P1 | FB-EDU-02, FB-EDU-11 | simulated | F-UI-04 | tests/unit/fabric-fixtures/success.test.ts | restricted student records gated by role | 4 |
| FB-WS-04 | admin, principal | P1 | FB-EDU-07, FB-EDU-14, FB-EDU-15 | simulated | F-UI-05 | tests/unit/fabric-fixtures/operations.test.ts | tenant-scoped reads | 4 |
| FB-WS-05 | accountant, principal | P1 | FB-EDU-13 | simulated | F-UI-06 | tests/unit/fabric-fixtures/finance-intel.test.ts | finance data confidential sensitivity | 4 |
| FB-WS-06 | staff, principal | P1 | FB-INT-01..04 | simulated | F-UI-07 | tests/unit/fabric-fixtures/insights.test.ts | read-only derived view | 4 |
| FB-WS-07 | owner, principal | P1 | FB-INT-05 | simulated | F-UI-08 | tests/unit/fabric-simulator.test.ts | scenario approval gate before "implementation" | 9 |
| FB-WS-08 | owner, principal | P1 | FB-TWIN-01..04 | simulated | F-UI-09 | tests/unit/fabric-fixtures/twin.test.ts | graph node cap, job-runner-only writes | 9 |
| FB-WS-09 | owner, principal | P1 | FB-AGT-01..04 | simulated | F-UI-10 | tests/unit/fabric-fixtures/agents.test.ts | risk-class ceiling (code + guard), approval gate (action via registry), local AI only: `<LimitedBadge/>` "Local AI only" | 5 |
| FB-WS-10 | owner, admin | P1 | FB-MKT-01..06 | simulated | F-UI-11 | tests/unit/fabric-fixtures/marketplace.test.ts | install-status trigger | 6 |
| FB-WS-11 | owner, principal | P1 | FB-STU-01..07 | simulated | F-UI-12 | tests/unit/fabric-fixtures/studio.test.ts | preview_html platform-admin only | 7 |
| FB-WS-12 | all | P1 | FB-PAI-01..05 | simulated | F-UI-13 | tests/unit/fabric-fixtures/personal.test.ts | own-rows RLS, no institution_id | 8 |
| FB-WS-13 | admin, owner | P1 | FB-DATA-01..03 | simulated | F-UI-14 | tests/unit/fabric-fixtures/data.test.ts | connector secrets vault-ref only | 3 |
| FB-WS-14 | owner, admin | P1 | FB-TRUST-01..05 | simulated | F-UI-15 | tests/unit/fabric-fixtures/trust.test.ts | tests/security/fabric-*.test.ts (0063) | ongoing |
| FB-WS-15 | staff | P1 | FB-WS-06, FB-INT-04 | simulated | F-UI-07 | tests/unit/fabric-fixtures/insights.test.ts | action link authorized + executed by page, not AI | 4 |
| FB-WS-16 | principal, teacher, accountant, admissions, admin | P1 | FB-WS-01, FB-INT-01 | simulated | F-UI-02 | tests/unit/fabric-fixtures/command.test.ts | briefing content role-scoped | 4 |

## PAI

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-PAI-01 | all | P1 | FB-AI-04, FB-MEM-01 | simulated | F-UI-13 | tests/unit/fabric-fixtures/personal.test.ts | own-rows RLS, no institution_id | 8 |
| FB-PAI-02 | all | P1 | FB-DATA-03, FB-MEM-01 | simulated | F-UI-13 | tests/unit/fabric-fixtures/personal.test.ts | own-rows RLS | 8 |
| FB-PAI-03 | all | P1 | FB-INT-04, FB-INT-06, FB-TWIN-02 | simulated | F-UI-13 | tests/unit/fabric-fixtures/personal.test.ts | outcome stored against own recommendation only | 8 |
| FB-PAI-04 | all | P2 | FB-ID-02, FB-ID-03, FB-COM-02 | planned | F-BE-24+ | tests/unit/fabric-fixtures/personal.test.ts | preferences/memory survive membership deactivation | 8 |
| FB-PAI-05 | all | P1 | FB-ID-02, FB-PAI-04 | simulated | F-UI-13 | tests/unit/fabric-fixtures/personal.test.ts | no institution AI call reads personal_memories without share flag | 8 |

## FIN

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-FIN-01 | owner, principal | P3 | FB-CORE-11 | planned | future pack | — | new pack, own RLS/permissions | 10 |
| FB-FIN-02 | owner | P3 | FB-FIN-01 | planned | future pack | — | sourced-claims requirement | 10 |
| FB-FIN-03 | owner | P3 | FB-FIN-01 | planned | future pack | — | documented risk-metric calculation | 10 |
| FB-FIN-04 | owner, platform admin | P3 | FB-FIN-03, FB-AGT-04, FB-TRUST-01 | planned | future pack | — | human_approved + kill switch + reconciliation log before execution | 11 |

## ENG

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-ENG-01 | platform admin | P3 | FB-INT-06, FB-MKT-02 | planned | F-BE-24+ | — | recommendation backed by measured evidence | 12 |
| FB-ENG-02 | platform admin | P3 | FB-AGT-01, FB-AGT-04 | planned | F-BE-24+ | — | independent security-review gate before merge | 12 |
| FB-ENG-03 | platform admin | P3 | FB-STU-04, FB-ENG-02 | planned | F-BE-24+ | — | generated module ships with its own test | 12 |
| FB-ENG-04 | platform admin | P3 | FB-ENG-02 | planned | F-BE-24+ | — | CI gate + rollback, no manual file surgery | 12 |
| FB-ENG-05 | platform admin | P3 | FB-ENG-02, FB-ENG-04 | planned | F-BE-24+ | — | no harness run holds prod-deploy permission | 12 |

## TRUST

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-TRUST-01 | owner, admin, platform admin | P1 | FB-ID-04, FB-CORE-08 | simulated | F-UI-15 | tests/unit/fabric-fixtures/trust.test.ts | tests/security/fabric-*.test.ts (0063) | ongoing |
| FB-TRUST-02 | platform admin | P2 | FB-AI-01, FB-AGT-04 | planned | F-BE-24+ | — | untrusted docs treated as data, never permission-elevating | ongoing |
| FB-TRUST-03 | owner, admin | P1 | FB-DATA-01, FB-ID-02 | simulated | F-UI-15 | tests/unit/fabric-fixtures/trust.test.ts | sensitivity class documented + RLS-enforced per table | ongoing |
| FB-TRUST-04 | owner, admin, platform admin | P1 | FB-AI-01, FB-INT-04 | simulated | F-UI-15 | tests/unit/fabric-fixtures/trust.test.ts | model_registry + confidence on every recommendation | ongoing |
| FB-TRUST-05 | platform admin | P2 | FB-CORE-08, FB-ENG-04 | planned | F-BE-24+ | — | failed run/sync surfaced within 5 min (health view) | ongoing |

## COM

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-COM-01 | owner, platform admin | P2 | FB-CORE-09 | planned | F-BE-24+ | — | billing data restricted sensitivity | 10 |
| FB-COM-02 | all, platform admin | P2 | FB-CORE-09, FB-PAI-04 | planned | F-BE-24+ | — | subscription independent of institution membership | 10 |
| FB-COM-03 | owner, platform admin | P2 | FB-COM-01, FB-COM-02, FB-PAI-04 | planned | F-BE-24+ | — | sponsorship end downgrades, never deletes personal data | 10 |
| FB-COM-04 | platform admin | P3 | FB-STU-03, FB-COM-01 | planned | F-BE-24+ | — | agreed cost basis recorded before building starts | 10 |
| FB-COM-05 | platform admin | P3 | FB-COM-01 | planned | F-BE-24+ | — | restricted sensitivity, platform-admin only | 10 |

## UX

| id | role | priority | deps | status | packet | tests | security | phase |
|---|---|---|---|---|---|---|---|---|
| FB-UX-01 | all | P1 | FB-CORE-01 | planned | F-UI-16 | — | n/a (presentation only) | 4 |
| FB-UX-02 | all | P1 | FB-UX-01 | simulated | F-BE-21 | tests/unit/nav-fabric.test.ts | permission-gated nav items (dashboard.view) | 4 |
| FB-UX-03 | all | P1 | FB-UX-02 | planned | F-UI-16 | — | every action is a real store intent or navigation | 4 |
| FB-UX-04 | all | P1 | FB-UX-03 | planned | F-UI-16 | tests/unit/fabric-store.test.ts | demo store only, no direct localStorage in components | 4 |
| FB-UX-05 | all | P1 | FB-UX-03, FB-UX-04 | planned | F-UI-16 | — | no success toast without a corresponding state change | 4 |

## Row count

CORE 12 · ID 5 · AI 5 · MEM 5 · AGT 4 · DATA 3 · INT 6 · TWIN 4 · MKT 6 · STU 7 · EDU 16 · DASH 7 · WS 16 · PAI 5 · FIN 4 · ENG 5 · TRUST 5 · COM 5 · UX 5 = **125 rows**, matching `01-master-prd.md`.
