---
name: feedback-model-routing
description: "Owner wants parallel subagents routed by complexity — Haiku small/basic, Sonnet integration, Opus only for hard reasoning; token saving is the main goal"
metadata:
  node_type: memory
  type: feedback
  originSessionId: b5c770a5-c937-4263-a0c7-edcb63b7bf8e
  modified: 2026-11-01T03:40:38.816Z
---

Owner (2026-11-01): "do work parallelly as possible, using specialised subagents … small basic tasks Haiku, a bit complex and integration Sonnet, difficult tasks that need a bigger model Opus … main focus is token saving with the best solution possible."

**Why:** faster milestones and controlled credit use; Sonnet session limits were hit twice running M03/M04 sequentially.

**How to apply:** per milestone, split tasks by file ownership so independent ones run at the same time (one DB-migration owner at a time; single-file db tests can overlap). Route: Haiku — permission keys, Zod schemas + unit tests, escalation fixtures, query-defs wrappers, registry lines, docs/tracker edits, CSV templates. Sonnet — migrations + RLS, actions, routes, integration/acceptance tests, security reviews. Opus — only genuinely hard design/reasoning (insights detectors, agent/workflow engines, assistant tool scoping, gate reviews). Always set `model` explicitly. Controller (main session) reviews small diffs itself. See [[feedback-token-budget]], [[master-plan-v1-v2]], [[agent-briefing-lessons]].
