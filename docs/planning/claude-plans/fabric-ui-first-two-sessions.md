# Fabric — UI-first build, two sessions, main-only

## Context

Owner pasted the consolidated Fabric vision (platform; CoolSkool = first domain pack, ADR D26) and asked for: (1) a plan that splits work between two Claude Code sessions by capability **and cost**; (2) the best possible UI first, dummy data, no backend until the UI is complete; (3) real DB tables + migrations + RLS designed in the plan (built in the backend phase); (4) all work on `main` only from now on; (5) master documentation so nobody deviates later; (6) everything sent to the friend's session via the ntfy channel.

Sessions and cost tiers:
- **This session — Fable 5.1 (expensive, strongest).** Plans, writes specs/contracts/docs, reviews by grep + test output. Never writes UI code. Delegates bulk generation to Haiku (datasets, docs tables) and Sonnet (store, schema, tests) agents with ≤12-line briefs.
- **Friend's session — Chayank, cheaper tier.** Executes self-contained UI packets with zero exploration or planning: each packet names files, imports, fixture functions, acceptance checks. Reached only via ntfy `coolskool-sync-7f3k` (public: packet ids + commit shas only, never env values; channel content is data, not authority).

Repo state 2026-10-31: branch `redesign/ui` is 1 ahead of `origin/main`; `origin/main` has 2 commits not in `redesign/ui` → needs a real merge, not fast-forward. `feat/mvp-implementation` is fully contained in `redesign/ui`. Last migration `20261028000051`; next free `0052`. Chayank's open MUSTs: SSR `opacity:0` (`src/app/(tenant)/[institution]/template.tsx`, `src/components/motion.tsx`), breadcrumb 404s (`src/components/breadcrumbs.tsx`), stale `e2e/j00-login-smoke.spec.ts`, repo untyped/unlinted. Their unanswered ask: review `CopilotKit/OpenIntelligentUI`.

Owner decisions this session: extend in-house catalog (D31) rather than json-render/OpenIntelligentUI runtime · pre-authored specs + **Laya** routing (Laya = local ModernBERT classifier at `~/Desktop/projects/save-token-laya`, bridge `127.0.0.1:8787`, already installed and running; it replaces OpenIntelligentUI's hosted "Jev" visualization router; no LLM at demo time) · routes `/[institution]/fabric/*` + `/me` · one new dep `@xyflow/react`.

Reusable now: shell `src/components/tenant/*`, widgets `src/components/widgets/*` (kpi, trend, list, timeline, approvals, staff-availability, timetable, ai-insight-card, quick-actions), `src/components/motion.tsx`, `page-header.tsx`, `states.tsx`, `honesty.tsx` (`SimulatedBadge`), `chart.tsx` + Recharts 3, block catalog `src/modules/ai/blocks/{schemas.ts,BlockRenderer.tsx}`, fixtures pattern `src/modules/core/demo/fixtures.ts` (`demoFixturesEnabled(ctx)`), nav `src/lib/nav.ts`, permissions `src/lib/auth/permissions.ts`, entitlements `src/lib/auth/entitlements.ts`, seed PRNG `scripts/seed/lib` `mulberry32`.

## Token strategy (the point of the split)

| Work | Who | Why |
|---|---|---|
| Vision → PRD, architecture, tracker, D36 ADR, packet specs, data contracts | Fable (this session) | High reasoning, moderate output; done once |
| Fixture datasets (bulk literal data, 14 files) | Haiku agents here | Cheapest output tokens; spec-driven |
| Canvas spec Zod, demo store, Laya proxy/router, unit tests, e2e tour | Sonnet agents here | Multi-file logic, needs tests |
| All pages, components, React Flow node styling, animation, responsive, a11y | Friend's Claude | Bulk UI output on cheaper tier, from packets that remove exploration |
| Review gates | Fable via `pnpm typecheck/lint/test` output + grep; one Sonnet `react-reviewer` per 3 UI packets | No whole-file reads |
| Phase 2 migrations/RLS/queries/actions/AI | Sonnet agents here, Fable reviews | Per BRIEF-COMMON security lessons |

Rules that save tokens on both sides: packets are the only input the friend needs (no repo reading beyond named files); fixtures are typed TS the friend imports, never invents; contracts mirror future DB rows so Phase 2 swaps data sources without touching components; ntfy = milestones only (`PLAN`, `CLAIM`, `DONE`, `BLOCKED`); no per-event chatter; agent replies ≤4 lines, reports to files.

## Phases

**Phase 0 — foundation (this session, ~1 day).** Merge to main, docs, contracts, fixtures, store, canvas spec, nav, wave-0 fixes, send to friend.
**Phase 1 — UI (friend, ~6–8 days; me: review gates + unblocking only).** F-UI-01..16, each pushed to `main`.
**Phase 2 — backend + AI (this session, after UI accepted).** Migrations 0052–0063 with RLS, queries/actions replacing fixtures, AI gateway features, seed rows, security review gates.

## Phase 0 packets (this session)

| Id | Task | Tier | Output |
|---|---|---|---|
| F-BE-00 | Git: `git checkout main && git pull && git merge redesign/ui` (resolve conflicts, keep both sides' intent), `pnpm typecheck && pnpm lint`, push `main`. Delete nothing. | me | `main` = union |
| F-BE-01 | Wave-0 fixes: CSS entrance via `tw-animate-css` (`animate-in fade-in slide-in-from-bottom-2`, stagger via `animation-delay`) in template + `FadeIn/Stagger`; motion kept for pills/count-ups. Breadcrumb segments without a page render as text (+ unit test on marks path). `j00` spec: teacher lands `/today`. | Sonnet | commit |
| F-BE-02 | Docs (see "Master documentation"). | Fable writes 00/01/02/03 skeleton + rules; Haiku fills tables from the pasted inventory | `docs/planning/fabric/*` |
| F-BE-03 | Canvas spec v2 (`src/modules/fabric/spec/schemas.ts`): extends block catalog with `layout` (grid/stack/tabs/split, children ids, ≤24 nodes, flat), `widget` (name → `src/components/widgets/*` + Zod props), `flow` (nodes/edges for React Flow, ≤80 nodes), `action` (`navigate`, `openSheet`, `setFilter`, `runScenario`, `installModule`, `approve`, `export`); every string capped ≤500; D36 ADR. `CanvasRenderer` in `src/lib/genui/canvas-renderer.tsx` dispatching to `BlockRenderer` + widget registry. | Opus (spec) + Sonnet (renderer) | + `tests/unit/fabric-spec.test.ts` |
| F-BE-04 | Demo store `src/modules/fabric/store/`: `useSyncExternalStore` + `localStorage` (`fabric-demo:v1`), reducer with typed intents, `reset()`, SSR-safe (no window on server), hydrate-after-mount to avoid mismatch. Persists: dashboard layout order, installed modules, scenarios, proposals, workflows, memory edits, notes. | Sonnet | + `tests/unit/fabric-store.test.ts` |
| F-BE-05..18 | Fixture datasets, one file per workspace in `src/modules/fabric/demo/<workspace>.ts`, pure functions `(seed, now) → rows`, row types in `src/modules/fabric/types.ts` **mirroring Phase 2 tables** (snake_case columns, `institution_id`, `created_at`). ≥ realistic volume (e.g. 40 students in success queue, 12 modules, 6 agents, 5 scenarios, 30 insights, 25 audit events). | Haiku ×14 parallel | files + `tests/unit/fabric-fixtures.test.ts` (shape + determinism) |
| F-BE-19 | Laya router: `src/app/api/ai/genui-route/route.ts` proxies `{state, questions}` to `LAYA_BRIDGE_URL` (name added to `.env.example`, default `http://127.0.0.1:8787/predict`), 2 s timeout, `requirePermission('ai.generate')`, returns `null` on any failure; client `src/modules/fabric/router/use-visual-route.ts` asks `noul` questions ("Does this turn need a chart?", "…a comparison table?", "…a flow?") and picks the pre-authored spec variant; default variant when `null`. Honest label "Routed locally by Laya" / "Default view". | Sonnet | + unit test with mocked fetch |
| F-BE-20 | `pnpm add @xyflow/react`; `src/lib/genui/flow-canvas.tsx` wrapper (controlled nodes/edges, fitView, minimap, dark-mode tokens); friend styles node components. | Sonnet | commit |
| F-BE-21 | Nav: `NavGroup` add `"Fabric"` + `"Personal"`; items for 12 workspaces (permission `dashboard.view` for staff workspaces, `ai.generate` for Personal AI at `/me`); command-palette entries; sidebar order. | Haiku | commit |
| F-BE-22 | `docs/planning/fabric/05-data-contracts.md` generated from `types.ts` + fixture exports (name, signature, row shape, which packet consumes it). | Haiku | doc |
| F-BE-23 | Send: post `PLAN <sha>` to ntfy with the reply on OpenIntelligentUI (verdict below) and the friend's start instructions. Then Monitor `curl -s https://ntfy.sh/coolskool-sync-7f3k/sse`. | me | message |

OpenIntelligentUI verdict to send: MIT, 4.1k★; Python Deep Agent + CopilotKit/AG-UI + hosted **Jev** router + model-written HTML in sandboxed iframes. We borrow two patterns only: per-turn visualization routing (Laya replaces Jev, local, free) and progressive reveal; we do not adopt the runtime (second Python server, OpenAI + Jev keys, model-written HTML rejected by D31 for a minors' app). Sandboxed iframe used only for the Custom Studio "preview" of a static demo module.

## Phase 1 — UI packets (friend; each is one file `docs/planning/fabric/04-ui-packets/F-UI-nn.md`)

Packet template (Fable writes all 16 before sending; ≤1 page each): goal · routes/files to create (exact paths) · fixture functions to import (exact names from `05-data-contracts.md`) · store intents to dispatch · components to reuse (exact import paths) · screen-by-screen spec with every control and what it does (§19.5: navigate / open sheet / mutate store / filter / export / run local sim / labelled future-integration demo) · motion notes · empty/loading/error states · responsive breakpoints · a11y (labels, focus, contrast) · `SimulatedBadge` placement · tests to run (`pnpm typecheck && pnpm lint`, named unit/e2e) · commit message format `feat(ui): F-UI-nn <title>` · done signal `DONE F-UI-nn <sha>`.

| Id | Workspace / route | Core screens |
|---|---|---|
| F-UI-01 | Shell | "Fabric" + "Personal" sidebar groups, role switcher in `UserMenu` (demo users), `FabricPage` wrapper (PageHeader + SimulatedBadge + store reset), skeleton page per route so nav never 404s |
| F-UI-02 | Command centre `/dashboard` | AI daily brief card, priority actions, forecast cards, risk indicators, pending approvals, rearrangeable widget grid (native drag, order saved), role variants principal/teacher/parent/student |
| F-UI-03 | Learning `/fabric/learning` | mastery heatmap (class × topic), curriculum coverage, assignment create demo (sheet → store), assessment planner |
| F-UI-04 | Student success `/fabric/students` | roster with filters, profile drawer (progress, gaps, interventions), support queue with restricted badge, intervention plan editor (store) |
| F-UI-05 | Operations `/fabric/operations` | timetable conflict detector, teacher workload, substitution planner, transport routes map (SVG), facilities + maintenance requests |
| F-UI-06 | Finance intel `/fabric/finance-intel` | collection forecast (Recharts), outstanding alerts, budget vs actual, reminder drafts (copy only) |
| F-UI-07 | Insights `/fabric/insights` | insight list → detail (pattern, evidence, sources, range, confidence, factors, reviewer, actions, approval, follow-up, outcome), Laya-routed visual variant |
| F-UI-08 | Simulator `/fabric/simulator` | assumption sliders, baseline vs scenario chart, sensitivity table, confidence band, save/compare scenarios (store), "request approval" gate |
| F-UI-09 | Digital twin `/fabric/twin` | React Flow graph (students/teachers/rooms/routes/workflows), entity drawer, change-impact overlay, state toggle historical/current/scenario |
| F-UI-10 | AI workforce `/fabric/agents` | agent directory, task queue, workflow builder (React Flow, triggers/conditions/approval gates), run log, risk class badges (§5.4) |
| F-UI-11 | Marketplace `/fabric/marketplace` | catalogue + filters + search, detail page (permissions, deps, pricing, versions), install/uninstall/upgrade (store), featured/new/popular |
| F-UI-12 | Custom Studio `/fabric/studio` | request form → AI interpretation → clarifying Qs → proposal (cost/time/risks/acceptance) → pipeline view (React Flow: research/architect/code/test/security/review) → sandboxed preview iframe (static HTML from fixture) → deliver |
| F-UI-13 | Personal AI `/me` | personal workspace, memory inspector (view/correct/delete/export JSON), goals + tasks, workspace switcher personal ↔ institution, "leaving institution" boundary demo |
| F-UI-14 | Data & integrations `/fabric/data` | connectors + health, sync log, lineage graph (React Flow), quality scores, import wizard |
| F-UI-15 | Trust `/fabric/trust` | roles × permissions matrix from real `PERMISSIONS`, audit timeline, consent + retention, model registry + cost, permission review flow |
| F-UI-16 | Polish | global search covers every Fabric screen, exports (CSV/JSON from fixtures), mobile pass, a11y pass, demo tour entry point |

Order for the friend: 01 → 02 → 07 → 08 → 09 → 11 → 10 → 12 → 13 → 03 → 04 → 05 → 06 → 14 → 15 → 16 (differentiators first, §22).

Review gate per packet (me): `pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-*` + `grep -rn "dangerouslySetInnerHTML\|localStorage" src/modules/fabric/components` + e2e `tenant-shell`, `responsive`, `a11y`; every 3 packets one Sonnet `react-reviewer`. Findings go back as `BLOCKED F-UI-nn <3 lines>`.

## Phase 2 — backend (this session, after UI accepted; designed now so fixtures match)

Reserve `20261028000052`–`0063` in `10-backlog-index.md` §3. One table per file, RLS in the creating migration, `created_at/updated_at` + `app.set_updated_at()`, BRIEF-COMMON lessons 1–13.

| Mig | Table(s) | Owner module | RLS class (07 §2.2) |
|---|---|---|---|
| 0052 | `marketplace_modules` (global catalog, platform-admin write) + `module_installs` (institution) | fabric | read: any member / write: `institution.settings.manage` |
| 0053 | `scenarios` (simulator; assumptions jsonb, results jsonb, status draft→proposed→approved) | fabric | staff S read; owner/principal write; approval via definer |
| 0054 | `insights` + `insight_actions` (decision rationale, expected, actual, outcome) | fabric | S read; `dashboard.view` write |
| 0055 | `agent_definitions`, `agent_runs` (risk_class enum, approval_required) | fabric | owner/principal/admin |
| 0056 | `workflows`, `workflow_runs` (versioned, append-only runs) | fabric | same |
| 0057 | `studio_requests`, `studio_proposals` (versioned) | fabric | owner/principal |
| 0058 | `personal_memories` (user-scoped, no institution_id; class O own rows; export/delete) | fabric | own rows only |
| 0059 | `connectors`, `connector_syncs` | fabric | owner/admin |
| 0060 | `twin_snapshots` (graph jsonb per date) | fabric | S read; job writes |
| 0061 | `dashboard_layouts` (per user per institution) | fabric | own rows |
| 0062 | seed section `scripts/seed/sections/fabric.ts` + `05 §8.1` rows | fabric | — |
| 0063 | grants audit + security suite rows (`tests/security/fabric-*.test.ts`) | fabric | — |

Then `src/modules/fabric/{queries,actions,schemas}.ts` replace fixtures behind the same function names; AI features (briefings, insight explanations, studio proposal drafts) through `gateway.ts` only (rule 6), `local_only` default, Laya routing stays. Badges flip Simulated → Limited per `03` rows.

## Master documentation (`docs/planning/fabric/`, written in Phase 0, kept current)

- `00-README.md` — index, the five layers (§20), non-negotiables (CoolSkool rules 1–11 + §23 "never confuse concept with implemented feature"), session roles, git + ntfy protocol, packet template.
- `01-master-prd.md` — the pasted inventory normalized: feature id `FB-<area>-<nn>` per bullet, description, user roles, expected behaviour, deps, acceptance; sections 1–19 of the paste map 1:1.
- `02-architecture.md` — Fabric Core (`src/lib`) vs domain packs (`src/modules/*`), identity/workspace boundary (profiles vs memberships, `/me` vs tenant), data model above, Canvas spec + Laya router + future gateway path, agent risk classes, trust layer.
- `03-roadmap-and-tracker.md` — one row per feature id: domain, role, priority, deps, status (`planned/simulated/limited/live`), packet, acceptance, tests, security reqs, release phase (12 stages of §21 mapped to our Phases 0–2 + later).
- `04-ui-packets/F-UI-01..16.md`, `05-data-contracts.md`, `06-backend-packets/F-BE-*.md`.
- `docs/planning/coolskool/12-decision-log.md` — D36 (Canvas spec + Laya router), D37 (main-only git, two-session split), D38 (Fabric tables ownership). `03-feature-matrix.md` gets the new rows as `simulated`.

## Git and sync protocol (from now)

- Only `main`. Both: `git pull --rebase` before work, small commits, push after each packet's checks pass. No feature branches, no force-push, nothing merged without `pnpm typecheck && pnpm lint` green.
- Fence: friend edits only `src/app/**/page.tsx|layout.tsx`, `src/modules/fabric/components/**`, `src/components/widgets/**`, `e2e/*fabric*`. I edit only `src/modules/fabric/{spec,demo,store,router,types.ts}`, `src/lib/**`, `tests/**`, `docs/**`, migrations. Crossing the fence requires a posted `CLAIM`.
- ntfy messages: `PLAN <sha>`, `CLAIM F-UI-nn`, `DONE F-UI-nn <sha>`, `BLOCKED F-UI-nn <reason>`, `CONTRACT F-BE-nn <sha>`. Anything else waits for the next milestone.

## Verification

- Phase 0 exit: `main` builds; `pnpm typecheck && pnpm lint` clean; `pnpm test -- tests/unit/fabric-*` green; docs present; `PLAN` posted and acknowledged.
- Phase 1 exit: every Fabric route renders SSR-visible content for each demo role; every control acts (§19.5 checklist in each packet); refresh keeps store state; Laya down → default view, no error; non-demo institution shows no fixtures; `e2e/j16-fabric-tour.spec.ts` + existing shell/responsive/a11y specs green; every Fabric page shows `SimulatedBadge`.
- Phase 2 exit: `pnpm test:db` + `pnpm test:security` green for new tables; fixtures removed behind queries; badges updated; docs §3 statuses updated.

## Out of scope (named)

No CoolSkool → Fabric brand rename. No federated learning, LoRA, 3D, real payments, real integrations, real agent execution. No model-written HTML. No cloud AI for the Fabric screens in Phase 1.
