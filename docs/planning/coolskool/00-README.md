# CoolSkool living spec — index

This directory is the living spec. Finished task packets, the planning prompt, and the original 20-day plan are in `../../archive/`. Source of truth for agent rules: `../../../CLAUDE.md`. Keep the single-home rule: link, never restate.

| File | Single home for |
|---|---|
| `01-executive-brief.md` | Objective, 13-step demo scenario with honesty labels, risks, roadmap, non-goals, environment baseline |
| `03-feature-matrix.md` | Feature catalog (F-xxx-nn), phases, demo status, dependencies |
| `04-architecture.md` | Context/module diagrams, request paths, tenant resolution, AI gateway, publishing, jobs, deployment modes, conventions |
| `05-data-architecture.md` | ERD, data dictionary, ownership, settings defaults, RLS strategy, migration order, seed design |
| `06-workflows-and-contracts.md` | Result envelope and error codes, workflows W1–W13, notification templates, audit catalog |
| `07-security-and-ai-governance.md` | Threat model, permission matrix, service-role allow-list, AI governance, security checklist (C-nn) |
| `08-testing-and-acceptance.md` | Test pyramid, commands, targets, nonfunctional checks, load scenarios, gates |
| `10-backlog-index.md` | Task DAG (T-001…), reserved migration numbers, review requirements |
| `11-operations.md` | Env var names, setup, demo logins, seed/reset/jobs, backup, troubleshooting, demo script, readiness gaps (§11) |
| `12-decision-log.md` | ADRs (D-nn), verified facts, debt register (§3, DBT-nn) |
| `13-level-2-candidates.md` | Post-Level-1 candidates |
| `14-generative-ui-plan.md` | Generative-UI plan (GU-nn) |
| `tasks/` | Open task packets (done ones are in `docs/archive/tasks/`) |

Navigating: read `CLAUDE.md` and your packet, then only the linked sections (e.g. `05 §2.6`, `06 §W9`, `07 §2`). New decision = ADR in `12`; new shortcut = debt row. Section numbers are cited from code and tests; never renumber.

Ids: `F-AAA-nn` features · `D-nn` ADRs · `W-n` workflows · `C-nn` security cases · `J-nn` E2E journeys · `L-n` load scenarios · `T-0nn` packets · `DBT-nn` debt · migrations `2026102800NN_<slug>.sql`.

## Fabric

The platform-level plan (vision, PRD, architecture, tracker, UI/backend packets) lives in `docs/planning/fabric/` — start at `docs/planning/fabric/00-README.md`. ADRs D26, D37–D39.
