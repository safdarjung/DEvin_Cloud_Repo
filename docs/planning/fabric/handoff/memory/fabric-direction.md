---
name: fabric-direction
description: "Owner's long-term vision — Fabric multi-domain AI platform; CoolSkool is its first (education) domain pack; no scope change to current packets"
metadata:
  node_type: memory
  type: project
  originSessionId: 389f81ff-0381-4199-9607-cbb7bd4a769d
  modified: 2026-10-29T11:04:46.028Z
---

On 2026-10-29 the owner named the long-term product **Fabric**: a universal adaptive-intelligence platform (personal + institutional workspaces, hybrid local/cloud AI routing, domain packs, forecasting/simulation, approved agentic execution, secure custom-module studio). CoolSkool is the first domain (education). Recorded as ADR D26 in `docs/planning/coolskool/12-decision-log.md`.

Roadmap levels set by owner 2026-10-29: **Level 1** = finish all 45 planned packets (T-001…T-045, the demo-ready foundation). **Level 2** = next, after Level 1: better UX, more features, deeper and better AI integration (needs a new plan when Level 1 completes). Approved candidates live in `docs/planning/coolskool/13-level-2-candidates.md` (L2-01 NotebookLM paste-import, L2-02 bring-your-own API key with per-feature data rules, L2-03 TimesFM forecasting on the dashboard: fee collections then attendance, baseline-backtested). Owner rejected nothing; lead advised against server-side NotebookLM cookie automation.

**Why:** owner wants every architectural decision checked against this direction, but explicitly said not to expand task scope or restart — finish the education product first.

**How to apply:** keep executing T-0NN packets as written; only flag decisions that would break the D26 boundaries (global `profiles` vs `memberships`, gateway-only AI calls, core in `src/lib` vs domain in `src/modules`). Do not rename CoolSkool → Fabric in code/UI without the owner asking. See [[coolskool-project]].
