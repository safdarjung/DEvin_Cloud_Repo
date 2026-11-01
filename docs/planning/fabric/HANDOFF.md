# Handoff — continuing the V1→V2 backend plan from another machine

State on 2026-11-01. Read this, then root `CLAUDE.md`, then `07-master-plan-v1-v2.md` §0–§5. Nothing else is needed to pick up.

## Where things stand

| Milestone | Status | Commit | Task cards |
|---|---|---|---|
| M01 API dispatcher (`/api/v1/actions`) | done | `b2e6872` | `06-backend-packets/M01-tasks.md` |
| M02 Query registry (`/api/v1/query`) | done | `1fe3756` | `M02-tasks.md` |
| M03 Onboarding + school setup (0064, 0065, 0079) | done | `27ce561` | `M03-tasks.md` |
| M04 CSV import/export (0066) | done | `849a305` | `M04-tasks.md` |
| M05 Documents/storage (0067) | done | `665a0ed` | `M05-tasks.md` |
| M06 Announcements, preferences, audit list (0068) | done | `87fa977` | `M06-tasks.md` |
| **M07 Timetable (0069)** | **next** | — | write `M07-tasks.md` |

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
