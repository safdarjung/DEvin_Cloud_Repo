# Task 12: M22-T12 Docs

Packet: M22-T12 Docs (CoolSkool backend plan)

Files changed: 
- `docs/planning/coolskool/10-backlog-index.md` (§3: 0055 entry updated to "(M22, built)" with tables, guard, agent_run_id)
- `docs/planning/coolskool/07-security-and-ai-governance.md` (§4: M22 service-role allow-list row added for `src/modules/agents/service-role.ts`)
- `docs/planning/coolskool/12-decision-log.md` (D46 added: agents execute in-request; DBT-41–46 debt register entries for M22 shortcomings/limits)
- `docs/planning/fabric/02-architecture.md` (§5: agent model description replaced with real code/registry mechanism, not trigger/definer)
- `docs/planning/fabric/03-roadmap-and-tracker.md` (FB-AGT-01/03/04, FB-WS-09 rows updated with real enforcement; honesty label "Local AI only" recorded)

Behavior implemented: 
Documentation of M22 architecture decisions (D46: in-request execution vs job queue, three reasons), security model (service-role allow-list, guard state machine), and known limits (DBT-41–46: run reaper missing, local-only engine, fixed ₹84/USD rate, stats summed in TS, bounded prompt injection, M23 holds queued status). Updated feature tracker to map code enforcement (risk computed by code + guard, approval via action registry) instead of older trigger/definer model. Added honesty label for agent UI: `<LimitedBadge/>` "Local AI only".

Tests run: `pnpm lint` → 0 errors (docs only, no code changes)

Tests not run and why: None required. Task 12 is documentation only; no code, no tests. Earlier tasks (T1–T11) already built and tested the backend.

Limitations / honesty label: 
Agents use local AI engine only (HIGH-2 per D32 caution, same as student AI study). Hosted runs end `failed`. Cost estimate uses fixed ₹84/USD (DBT-43). 30-day stats truncated at 1000 rows (DBT-44). Prompt injection bounded by catalog + approval gate, not prevented (DBT-45). No job reaper for stuck `running` runs mid-crash (DBT-41); cron cleanup deferred to when/if it's observed.

Security / integration risks: None. Documentation only. Earlier security reviews (T4, T6, T7, T8) validated the code; this task records that validation and the design intent.

Follow-ups: 
- DBT-41 (run reaper) if a school runs enough agents to accumulate crashed `running` rows
- DBT-43 (cost rate) when institutions get per-school billing settings (compare pattern with D30 `features`)
- DBT-44 (stats aggregation) when a school hits >1000 runs/30d (move to SQL view)
- DBT-45 (injection vector) if adoption shows real exploitation (add per-call redaction, tighter de-dup)
- DBT-46 (workflow integration) in M23 when queued status and workflow_run_id FK land
- D46 revisit when sub-minute latency needed or job runner gains gateway support

New dependencies (justification): none

Assumptions made: 
- M22 tests (T1–T11) all passed green before T12 docs merged
- Earlier U-turn from trigger/definer model to action registry happened as part of T7/T8 execution (not documented in this diff)
- Honesty label `<LimitedBadge/>` syntax matches existing `src/components/honesty.tsx` export

