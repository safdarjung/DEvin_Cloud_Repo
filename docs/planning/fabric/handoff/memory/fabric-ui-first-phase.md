---
name: fabric-ui-first-phase
description: "Fabric UI-first build state (2026-10-31) — main-only git, two-session split, packets in docs/planning/fabric, Laya replaces Jev, Phase 2 backend reserved 0052–0063"
metadata:
  node_type: memory
  type: project
  originSessionId: 609595c9-cada-4584-980e-e7397a1f259e
  modified: 2026-10-31T11:21:30.723Z
---

On 2026-10-31 the owner approved a UI-first showcase of the whole Fabric vision on dummy data (vision verbatim: `docs/planning/fabric/source/vision-2026-10-31.md`; index `docs/planning/fabric/00-README.md`). Phase 0 shipped on `main` (`d0acb28` code, `9e3ac52` docs): `src/modules/fabric/{types,demo,store,spec,router}`, `src/lib/genui` (CanvasRenderer + FlowCanvas, `@xyflow/react` 12.12.0 is the one new dep), Laya proxy route `/api/ai/genui-route`, nav groups Fabric/Personal + placeholder pages. ADRs D37 (Canvas spec + Laya router), D38 (main-only, cost split), D39 (Fabric tables).

Split: this session (Fable) plans/contracts/docs/reviews and delegates bulk to Haiku/Sonnet; friend **Chayank**'s cheaper-tier Claude implements `docs/planning/fabric/04-ui-packets/F-UI-01..16.md` in order 01→02→07→08→09→11→10→12→13→03→04→05→06→14→15→16, one commit each on `main`. Channel ntfy `coolskool-sync-7f3k`: `PLAN/CLAIM/DONE/BLOCKED/REVIEW` only. PLAN 9e3ac52 posted; awaiting ACK + CLAIM F-UI-01.

"Jev" in the owner's ask = OpenIntelligentUI's hosted visualization router; Laya (`~/Desktop/projects/save-token-laya`, bridge `127.0.0.1:8787`, noul yes/no classifier) replaces it; no LLM at demo time.

Phase 2 (after UI accepted): migrations `20261028000052`–`0063` reserved (plan in `02-architecture.md` §4), queries/actions behind fixture names, AI via gateway, seed, security suite.

**Why:** owner wants the best UI first, minimal tokens, no deviation from the vision.
**How to apply:** when a `DONE F-UI-nn` arrives, review via `pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric` + grep, every 3 packets one Sonnet react-reviewer; answer `BLOCKED` with a `CONTRACT F-BE-nn` commit. Do not write UI code here. See [[coolskool-project]], [[fabric-direction]], [[feedback-token-budget]].
