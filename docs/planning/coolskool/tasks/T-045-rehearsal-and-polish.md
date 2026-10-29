# T-045 — Rehearsal, polish, honesty-label audit

| Field | Value |
|---|---|
| Lane / Day | Lead / Day 19 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | code-reviewer |
| Feature ids | all P0 rows in `03 §1` with Demo ∈ {impl, limited, sim} |
| Depends on | T-044 (merged) |
| Migration | — |

## Business outcome
A principal watches the 13-step story in under 25 minutes with no technical explanation needed, every simulated or limited feature is honestly labelled, and the team has a backup recording.

## Current repo state (verify before starting)
- Hosted deployment green: `results/deploy-18.md` exists and J-00…J-13 passed.
- `demo:reset` works against hosted (operator shell with hosted env).
- `<SimulatedBadge />` component exists: `ls src/components/simulated-badge.tsx`.

## Spec sections to read (only these)
- `09-twenty-day-plan.md §8` (rehearsal steps), `§7` (fallback ladder, if needed).
- `11-operations.md §10` (demo script), `§3` (accounts).
- `01-executive-brief.md §2` (status label per step) and `§9` (real vs simulated).
- `08-testing-and-acceptance.md §7` (G-2 gate), `§5` (a11y/responsive smoke).

## Files to inspect first
- `e2e/demo-narrative.spec.ts`; pages listed in `11 §10`; `src/lib/nav.ts`.

## Expected changes
- Honesty-label audit: table of every feature with Demo = `limited` or `sim` in `03 §1` → page/component → badge present (fix missing badges: message log, AI quiz provider line, student portal note, platform admin page, simulated email).
- Copy polish: page titles, empty states, toasts, error messages in plain English; demo banner text; login hint panel wording.
- Rehearsal runs: two full passes from `pnpm demo:reset` on hosted with a stopwatch; narration notes per step; fix small UI issues found (no new features; anything larger → `09 §7` decision with the lead).
- Backup recording: screen capture of a clean pass stored outside the repo (path recorded in results).
- `docs/planning/coolskool/results/rehearsal-19.md` — timings per step, issues found/fixed, moments needing explanation, final G-2 checklist with evidence lines.
- `11-operations.md §11` and `12 §3` — update gaps/debt if the rehearsal surfaced new ones (the only doc edits permitted).

## Must not modify
- Migrations; permission matrix; any security test.

## Permissions / nav / migration numbers needed from the lead
- None.

## Security and data-integrity requirements
- Rehearsal uses demo accounts only; reset between runs; no real names typed into forms.
- Fixes merged only with their packet's targeted tests green plus `pnpm test:e2e -- e2e/demo-narrative.spec.ts`.

## Acceptance criteria
1. Two consecutive passes of the 13-step script complete in < 25 minutes each from a reset state; the second pass needs zero fixes.
2. Every `limited`/`sim` feature shows its badge (audit table complete, no gaps).
3. A11y smoke (`@axe-core/playwright`) shows no serious/critical violations on the five pages in `08 §5`; responsive smoke at 390×844 passes.
4. `results/rehearsal-19.md` filled, including the G-2 gate with each line marked met/not met and evidence.
5. Backup recording exists and its location is recorded.

## Script and runbooks
- Rehearse exactly `11 §10` (minute budget per step) twice from a reset; exercise the runbooks in `11 §13` once each (reset mid-session, jobs stuck, Ollama down, Wi-Fi loss) and record outcomes.

## Tests (write failing tests first) and exact commands
- `e2e/demo-narrative.spec.ts` (existing) run twice: `pnpm demo:reset && PLAYWRIGHT_BASE_URL=<url> pnpm test:e2e -- e2e/demo-narrative.spec.ts`.
- `e2e/a11y.spec.ts`, `e2e/responsive.spec.ts` (from T-041/T-014 day) rerun.

## Deliverables
- Badge/copy fixes, results file, recording location, updated gaps/debt, completion report.

## Assumptions and risks
- Venue connectivity may fail: the recording and a local run (`pnpm dev` + local Supabase + Ollama) are the fallback; verify the local path still works after reset on Day 19.
- Scope creep is the main risk: anything not on the 13-step script is deferred to `11 §11`.

## Completion report
Use the format in `CLAUDE.md`.
