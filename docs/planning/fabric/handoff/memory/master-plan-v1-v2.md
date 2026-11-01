---
name: master-plan-v1-v2
description: 2026-10-31 owner-approved direction — reach V2 feature-complete backend/API first; master plan docs/planning/fabric/07-master-plan-v1-v2.md (M1–M27), Opus decomposes, Sonnet executes one task at a time
metadata:
  type: project
---

On 2026-10-31 the owner asked for a master plan to reach roadmap **V2** (complete school OS + intelligent school) with backend + HTTP APIs for everything, UI deferred to one final pass (shadcn, optionally cult-ui). Fable wrote `docs/planning/fabric/07-master-plan-v1-v2.md`: 27 milestones (A: API dispatcher, query registry, onboarding, CSV import, documents, announcements, timetable, staff attendance/leave, submissions, curriculum, question bank, finance completion incl. Razorpay test mode, operations, lifecycle, scheduled reports, real dashboards, Resend, backup; C: insights engine, mastery, baseline forecasts, bounded agents, workflows, assistant, briefings, modules, fabric seed + security). Migrations 0064–0089 reserved for V1 completion; 0052–0063 stay Fabric.

Owner answers: API = one dispatcher route over the action registry (+ query registry); Chayank's UI track continues in parallel on fixtures; no channel/provider keys yet (simulated default, Resend/MSG91/Razorpay-test as later milestones); AI = Gemini free key + local Ollama, no Anthropic key.

Execution model: Fable writes plan → **Opus** picks the next milestone, writes `06-backend-packets/M<nn>-tasks.md` (tasks ≤3 files, ≤150 lines, one test file) → **Sonnet** executes one task, Opus verifies, next. Protocol is plan §4, task card §5.

**Why:** owner wants a demo-ready system ("promise onboarding in 3 days") and level-by-level verification without burdening agents.
**How to apply:** do not expand scope beyond §3; V3/V4 items (simulator, twin, studio, personal memory, connectors) stay fixtures. See [[fabric-ui-first-phase]], [[feedback-token-budget]], [[agent-briefing-lessons]].

Progress: M01 done `b2e6872`, M02 `1fe3756`, M03 `27ce561`, M04 `849a305`, M05 `665a0ed`, M06 done `87fa977` (2026-11-01; hosted at 0079 incl. 0067+0068, owner pushed and grants verified). Next: M07 timetable (0069). Hosted DB migration state unverified; 0065 was applied locally after 0079, so a hosted push needs --include-all. SDD ledgers per milestone in `.superpowers/sdd/M<nn>-tasks/progress.md` (git-ignored) — read it first after compaction. Controller reviews small task diffs itself; one Sonnet security-reviewer per milestone diff.
