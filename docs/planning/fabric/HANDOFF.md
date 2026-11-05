# Handoff — continuing the V1→V2 backend plan from another machine

State on 2026-11-03 (updated after M08–M14 + M17). Read this, then root `CLAUDE.md`, then `07-master-plan-v1-v2.md` §0–§5. Nothing else is needed to pick up.

## Where things stand

| Milestone | Status | Commit | Task cards |
|---|---|---|---|
| M01 API dispatcher (`/api/v1/actions`) | done | `b2e6872` | `06-backend-packets/M01-tasks.md` |
| M02 Query registry (`/api/v1/query`) | done | `1fe3756` | `M02-tasks.md` |
| M03 Onboarding + school setup (0064, 0065, 0079) | done | `27ce561` | `M03-tasks.md` |
| M04 CSV import/export (0066) | done | `849a305` | `M04-tasks.md` |
| M05 Documents/storage (0067) | done | `665a0ed` | `M05-tasks.md` |
| M06 Announcements, preferences, audit list (0068) | done | `87fa977` | `M06-tasks.md` |
| M07 Timetable (0069) | done | see `git log` | `M07-tasks.md` |
| M08 Staff attendance, leave, substitution, period attendance (0070) | done, hosted | `94a7032` | `M08-tasks.md` |
| M09 Assignment submissions + grading (0071) | done, hosted | `e9ab47f` | `M09-tasks.md` |
| M10 Lesson plans + curriculum coverage (0072) | done, hosted | `1bca1b2` | `M10-tasks.md` |
| M11 Question bank, exam schedule, report card HTML (0073) | done, hosted push pending | `6277a35` | `M11-tasks.md` |
| M13 Facilities, transport, calendar (0075) | done, hosted push pending | `5605727` | `M13-tasks.md` |
| M14 Student lifecycle (0076) | done, hosted push pending | `7e4e1cb` | `M14-tasks.md` |
| M17 Resend email channel (no migration) | done | `3c9a7e0` | `M17-tasks.md` |
| **MOD plug-in modules (0084, D45)** | **next** | — | `MOD-tasks.md` (planned; retrofit all of M01–M17) |
| M12 Finance+ (0074, 0082, 0083) | built, hosted push pending | `2162d32` | `06-backend-packets/M12-tasks.md` |
| M15 Scheduled reports (0077) | built, hosted push pending | `b6da3ea` | `06-backend-packets/M15-tasks.md` |
| M16 Dashboards + approvals (0078) | built, hosted push pending | `ba6e266` | `06-backend-packets/M16-tasks.md` |
| M18 Backup/restore drill (no migration) | built | `1f83537` | `06-backend-packets/M18-tasks.md` |
| M19–M25 (V2, renumbered 0092–0096) | planned | — | `M19..M25-tasks.md` |
| X01–X08 extension modules (0085–0091, 0099) | planned | — | `X01..X08-tasks.md` |

Hosted Supabase is migrated through `0079` (0049–0051 history repaired, 0064–0068 + 0079 pushed, grants verified). Last full gate: unit 958, db 497/498 (DBT-46 flaky invoice chunk test, passes alone), security 1382.

Remaining: M07–M18 (12), V1-GATE, M19–M27 (9), then Workstream D (UI integration, separate plan).

## How the work is run (owner decisions)

- **Controller** (the main Claude session, Opus) writes `06-backend-packets/M<nn>-tasks.md`, dispatches subagents, reviews diffs, commits, pushes to `main`, posts `CLAIM`/`DONE` on ntfy `coolskool-sync-7f3k`.
- **Model routing** (owner, 2026-11-01): run independent tasks **in parallel**; Haiku for small mechanical work (permission keys, Zod schemas + unit tests, fixtures, query-defs, docs); Sonnet for migrations + RLS, actions, routes, integration/acceptance tests, security reviews; Opus only for genuinely hard design (insights detectors, agent/workflow engines, assistant tool scoping, gate reviews). Always set the model explicitly. Token saving first.
- One DB-migration owner at a time; single-file db tests may overlap. Single-file runs: `pnpm test:db tests/db/x.test.ts` — **no `--`** (with `--` the whole project runs).
- Per milestone: one Sonnet security review on the diff; controller fixes CRIT/HIGH/MED; full gate `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm test:security`.
- **Hosted DB pushes are owner-run** (the auto-mode classifier blocks them as production deploys): `pnpm exec supabase db push --linked --include-all` (`--include-all` because 0064–0068 sort below 0079).
- Replies to the owner: terse (caveman), milestone-level only.

## Where the supporting material is

- `.superpowers/sdd/10-backlog-index/BRIEF-COMMON.md` — the common brief every implementer reads (rules + security lessons). Force-added to git; the folder has its own `.gitignore` (`*`), so new ledger files need `git add -f`.
- `.superpowers/sdd/M0<n>-tasks/` — per-milestone ledger (`progress.md`: rulings, review outcomes), task briefs, agent reports, security reviews.
- `docs/planning/fabric/handoff/memory/` — copy of the controller's memory (`MEMORY.md` index + one file per fact). To reuse on another machine, copy these into that machine's `~/.claude/projects/<escaped-repo-path>/memory/`.
- `docs/planning/claude-plans/` — the two plan-mode plans that started this phase (Fabric UI-first two-session plan; CoolSkool planning prompt).
- Decisions D40–D44 and debt DBT-42…46: `docs/planning/coolskool/12-decision-log.md`. Definer/storage rows: `07-security-and-ai-governance.md` §4. Onboarding runbook: `11-operations.md` §14.

## Recurring traps (already in BRIEF-COMMON)

- New action → import in `src/app/api/v1/actions/all-actions.ts` + C-03 fixture in `tests/security/escalation.test.ts`. New query → `query-defs.ts` + `all-queries.ts` + sample input in `tests/db/api-query-route.test.ts`.
- Files the seed scripts import (e.g. `src/modules/core/schemas.ts`) use relative `.ts` imports, never `@/` — a broken reseed empties the demo tenant.
- RLS violations (`42501`) and unique violations (`23505`) surface as `internal` unless the action maps them.
- Plain RLS insert into `guardian_students` recurses (DBT-45) — use a definer or fix `app.my_student_ids`.

## How the 2026-11-02/03 batch was run (reuse)

- Two lanes: main tree + worktree `../coolschool-b` (branch `lane-b`) with its own Supabase stack (`project_id = "coolschool_b"`, ports 544xx, studio/realtime/smtp/edge/analytics off; `config.toml` marked `--skip-worktree`, `.env.local` copied with ports rewritten). Lanes merge into main, then one full gate.
- Workflow scripts (controller session dir): milestone runner = Opus planner → Haiku/Sonnet tasks scheduled by deps with DB-exclusive tasks run alone → Sonnet security review → Sonnet fix → gate. Traps found: the `security-reviewer` agent type cannot write files (pass findings inline to the fixer); gate agents' 10-min command limit kills `test:db` (run it in background); fixtures must compute "today" in the institution timezone (UTC breaks 00:00–05:30 IST).
- Hosted DB: owner runs `pnpm exec supabase db push --linked --include-all`. Once pushed, a migration is frozen — fixes go into a new number (BRIEF-COMMON HOSTED-APPLIED rule).
