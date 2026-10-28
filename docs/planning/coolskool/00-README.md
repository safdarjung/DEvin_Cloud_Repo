# CoolSkool planning package — index

Produced 2026-10-28 by the planning run defined in `00-planning-prompt.md`. This run planned; it did not implement, install, migrate, deploy, or test anything. Implementation starts after user review, with Claude Sonnet 5 agents executing packets in `tasks/`.

## Documents

| File | What it is the single home for |
|---|---|
| `01-executive-brief.md` | Objective, 13-step demo scenario with honesty labels, risks, five-phase roadmap, non-goals |
| `02-environment-baseline.md` | Machine/repo/account facts, credential gaps, what is unverified |
| `03-feature-matrix.md` | Full long-term catalog with IDs (F-xxx-nn), phases, demo status, priorities, dependencies; five-phase dependency map |
| `04-architecture.md` | Context and module diagrams, request paths, tenant resolution, AI gateway, website publishing, jobs/notifications, deployment modes, conventions |
| `05-data-architecture.md` | ERD, data dictionary, ownership matrix, settings JSON defaults, RLS strategy, history/deletion, migration order, seed design, integrity tests |
| `06-workflows-and-contracts.md` | Result envelope and error codes, the 13 workflows (W1–W13), notification templates, audit catalog |
| `07-security-and-ai-governance.md` | Threat model, permission matrix, data classification, service-role allow-list, AI governance, executable security checklist (C-nn) |
| `08-testing-and-acceptance.md` | Test pyramid, commands, unit/DB/E2E targets, nonfunctional checks, load scenarios, gates |
| `09-twenty-day-plan.md` | Day-by-day plan, lanes, conflict zones, delays, risk register, fallback ladder, rehearsal |
| `10-backlog-index.md` | Task DAG and index (T-001…T-045), reserved migration numbers, review requirements |
| `11-operations.md` | Env var names, local/hosted setup, demo logins, seed/reset/jobs, backup, Google sign-in notes, hybrid hosting path, troubleshooting, demo script, readiness gaps |
| `12-decision-log.md` | ADRs D1–D24, Phase 0 verified facts with sources, debt register |
| `tasks/T-0NN-*.md` | One packet per task |
| `../../../CLAUDE.md` (repo root) | Agent operating instructions: stack, commands, conventions, rules, pre-code protocol, completion report |

## How an implementation agent navigates

1. Read `CLAUDE.md` (root) and your packet in `tasks/`.
2. Open only the sections your packet links (e.g. `05 §2.6`, `06 §W9`, `07 §2`).
3. Follow the pre-code protocol in `CLAUDE.md`; write the failing tests named in the packet first.
4. Deliver the completion report in the packet's format.

## How the lead uses the package

- Day plan and checkpoints: `09`. Assign packets by lane; respect deps in `10`.
- Reserve migration numbers and nav/permission additions before a lane starts (`09 §4`).
- Run the full suite at checkpoints; keep `12 §3` (debt) and `11 §11` (gaps) current.
- Any new decision becomes an ADR in `12`; any new shortcut becomes a debt row. Never restate decisions elsewhere; link.

## Naming conventions used across the package

`F-AAA-nn` feature ids · `D-nn` ADRs · `W-n` workflows · `C-nn` test cases · `J-nn` E2E journeys · `L-n` load scenarios · `T-0nn` task packets · `DBT-nn` debt items · migrations `2026102800NN_<slug>.sql`.
