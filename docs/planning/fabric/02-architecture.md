# 02 — Fabric technical architecture

Status: Phase 0 (2026-10-31). Extends `docs/planning/coolskool/04-architecture.md`; where they differ for Fabric screens, this file wins. ADRs: D26 (direction), D31 (closed block catalog), D37 (Canvas spec + Laya router), D38 (main-only, two-session split), D39 (Fabric tables).

## 1. Core vs domain packs

| Layer | Lives in | Rule |
|---|---|---|
| Fabric Core | `src/lib/**` (auth, actions envelope, ai gateway, audit, genui) | Domain-agnostic. No school nouns. |
| Domain pack: education | `src/modules/{core,people,academics,attendance,admissions,finance,exams,website,notifications,jobs,ai}` | Existing CoolSkool modules. One owner per entity. |
| Fabric workspaces | `src/modules/fabric/{types.ts,spec,demo,store,router,components}` + routes `src/app/(tenant)/[institution]/fabric/*`, `/me` | Intelligence/extensibility surfaces over the domain pack. Reads other modules only through their `queries.ts` (Phase 2). |
| Future packs | `src/modules/<pack>/` | Same shape; marketplace modules are data, not code, until Custom Studio ships real builds. |

## 2. Identity and workspace boundary

- `profiles` (global, one per user) vs `memberships` (per institution, carries role). Unchanged.
- **Personal workspace** = rows keyed by `user_id` with **no** `institution_id` (`personal_memories`, `personal_goals`). RLS: own rows only, every role, cross-institution included (class O).
- **Institutional workspace** = rows with `institution_id` under tenant RLS as today.
- Leaving an institution (vision §2.3): membership deactivated → institution rows invisible; personal rows untouched; `is_shared_with_institution` flags cleared by a definer function, never by copying data across. Phase 1 demonstrates this with `boundaryPreview()` in `demo/personal.ts`; Phase 2 implements it in SQL.
- Phase 1 route for Personal AI is `/[institution]/me` (inside the tenant shell, with a workspace switcher). A root `/me` outside the tenant layout is Phase 2+ once personal rows exist.

## 3. Generative UI: Canvas spec + Laya router (D37)

```
pre-authored CanvasSpec JSON (per screen, per variant)
        │  (Zod: src/modules/fabric/spec/schemas.ts)
        ▼
CanvasRenderer (src/lib/genui/canvas-renderer.tsx) ── onAction(action) ──► page handler ──► demo store dispatch / navigate / export
   ├─ 7 D31 blocks → BlockRenderer (src/modules/ai/blocks)
   ├─ widget → WIDGETS registry (src/lib/genui/widget-registry.ts → src/components/widgets/*)
   ├─ layout → grid | stack | tabs | split
   └─ flow → FlowCanvas (src/lib/genui/flow-canvas.tsx, @xyflow/react, client-only)

variant choice:  useVisualRoute() ──► POST /api/ai/genui-route ──► LAYA_BRIDGE_URL (local ModernBERT classifier, noul yes/no)
                                        requirePermission('ai.generate') · 2 s timeout · any failure → null → default variant
```

Invariants: no model ever emits HTML; every string ≤500 chars; lists flat; ≤24 nodes per spec; hrefs internal only; actions are data the page authorizes and executes. Laya *routes*, it does not generate. A later live mode (Ollama emitting CanvasSpec JSON) goes through `src/lib/ai/gateway.ts` only (rule 6) and is not in Phase 1.

Why not a framework: evaluated OpenIntelligentUI (CopilotKit; Python agent + hosted Jev router + sandboxed model-written HTML), json-render (Vercel; catalog → JSON → renderer), A2UI, AG-UI, `streamUI`. Our spec keeps json-render's shape (catalog, flat node list, named actions) and A2UI-compatible ids so an adapter is cheap, without the runtime, keys or HTML sandbox. Sandboxed iframes appear once: the Custom Studio "preview" of a static fixture HTML string (`sandbox=""`, no scripts).

## 4. Data model (Phase 2 tables; Phase 1 fixtures mirror them)

Types: `src/modules/fabric/types.ts`. Reserved migrations `20261028000052`–`0063` (`10-backlog-index.md` §3). All tenant tables: `institution_id`, `created_at`, `updated_at`, `app.set_updated_at()`, RLS in the creating file, every user-supplied FK bound to the same institution in `with check`, initPlan helpers (`col = any((select app.my_*()))`), no per-row definer calls.

| Mig | Tables | Read | Write | Notes |
|---|---|---|---|---|
| 0052 | `marketplace_modules` (global), `module_installs` | any member / any member | platform admin / `institution.settings.manage` | install status machine `pending_approval→installed↔disabled→uninstalled` by trigger |
| 0053 | `scenarios` | staff (S) | owner, principal | `status` draft→proposed→approved/rejected via definer `public.decide_scenario`; results jsonb; `is_baseline` unique per institution |
| 0054 | `insights`, `insight_actions` | S | `dashboard.view` roles | actions append-only (outcome measured by new row with `superseded_by`) |
| 0055 | `agent_definitions`, `agent_runs` | owner, principal, admin | owner, principal | `risk_class` enum; `human_approved` runs need `approver`; runs append-only |
| 0056 | `workflows`, `workflow_runs` | owner, principal, admin | owner, principal | `version` bump on edit (new row), runs append-only |
| 0057 | `studio_requests`, `studio_proposals` | owner, principal | owner, principal | proposals versioned; `preview_html` only platform-admin written |
| 0058 | `personal_memories`, `personal_goals` | own rows | own rows | no `institution_id`; export/delete actions; `retain_until` job |
| 0059 | `connectors`, `connector_syncs` | owner, admin | owner, admin | secrets never in rows (vault ref only) |
| 0060 | `twin_snapshots` | S | job runner (service role) | graph jsonb ≤80 nodes; nightly job |
| 0061 | `dashboard_layouts` | own rows | own rows | per user × institution × role |
| 0062 | seed `scripts/seed/sections/fabric.ts` | — | — | `05 §8.1` rows added; demo tenant only |
| 0063 | grants audit + `tests/security/fabric-*.test.ts` | — | — | isolation, BOLA, escalation per table |

Derived read models (no tables): mastery, coverage, student success, operations, finance intelligence, trust views — computed in Phase 2 from existing tables via the owner modules' `queries.ts`.

## 5. Agent model (vision §5.4)

`RiskClass`: `read_only` → `low_risk_reversible` → `user_confirmed` → `human_approved` → `prohibited`. An agent definition carries `max_risk_class`; a run above it is rejected at insert (trigger). `human_approved` runs stop in `awaiting_approval` until a member with the matching permission approves (definer). Phase 1 shows this state machine with fixtures and the demo store; nothing executes.

## 6. Demo store (Phase 1 persistence, vision §19.4)

`src/modules/fabric/store`: `useDemoStore(selector)` + `dispatch(intent)`; `localStorage` key `fabric-demo:v1`; SSR-safe (server snapshot = unhydrated initial state, hydrate after mount); versioned; `reset`, `exportJson`, `parseImport` (Zod). Intents are the Phase 2 action names, so pages migrate by swapping `dispatch` for the real `ActionResult` call.

## 7. Trust layer in the UI

Roles × permissions matrix renders the real `PERMISSIONS` from `src/lib/auth/permissions.ts`; audit timeline, consent, model registry and permission reviews are fixtures until 0063. Every Fabric page carries `<SimulatedBadge />`.

## 8. Dependencies

Added in Phase 0: `@xyflow/react` 12.12.0 (twin, workflow builder, studio pipeline, lineage). Everything else uses installed `motion`, `tw-animate-css`, Recharts, shadcn/radix, cmdk.
