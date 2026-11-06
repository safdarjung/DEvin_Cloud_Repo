# M24 security review — School-aware assistant

Independent review (read-only; no edits made outside this file). Scope:
`src/modules/ai/assistant/{tools,catalog}.ts`, `src/modules/ai/agent/cloud-stream.ts`,
`src/app/api/ai/agent/assistant/route.ts`, `src/modules/agents/tools.ts`
(`buildReadTools`), `src/lib/ai/ui-message-schema.ts`, their unit/db tests, and
the M24 doc edits (`07-security-and-ai-governance.md`, `12-decision-log.md`,
`03-roadmap-and-tracker.md`). Verified against the spec
(`docs/planning/fabric/06-backend-packets/M24-tasks.md`) and
`.superpowers/sdd/10-backlog-index/BRIEF-COMMON.md`.

A prior fix pass (recorded in this same file before this review, now
superseded below) found and fixed two HIGH + one LOW issue; both fixes were
independently re-verified in code (not just trusted from that file) and hold:
`redactUserText` in `route.ts` now maps every message's text parts through
`redact()` regardless of role (lines 77-89), and `07-security-and-ai-governance.md`
§5 no longer overclaims name redaction. Those are not re-listed below.

## Findings

- MEDIUM | `docs/planning/coolskool/12-decision-log.md` | T8 added "### D46 — Staff-wide assistant..." (line 293) but D46 was already used by "### D46 — Agents execute in-request as the caller..." (M22, line 303) — duplicate ADR ID breaks traceability (any future reference to "D46" is ambiguous). Fix: renumber the M24 entry to the actual next free D-number (D47) and fix any cross-references.
- LOW | `src/modules/ai/assistant/catalog.ts` / `src/modules/ai/assistant/tools.ts` | `aggregate` flags are reviewed judgement only, not machine-checked (acknowledged as a "not built" debt item, DBT-101) — spot-checked `finance.collectionReport` (groupBy term/grade/mode only, no student rows) and `insights.riskIndicators` (domain-level counts + opaque insight id) and both are correctly aggregate; no miscategorization found in this pass, but nothing in CI would catch a future one. No code change requested; confirms DBT-101 is the right tracking item.
- LOW | `src/modules/ai/agent/cloud-stream.ts` | `console.error` on stream failure logs the caught `err` object (line 163), which for an AI-SDK/provider error can embed the request's redacted message text or a provider error body; acceptable risk (text is already redacted before reaching here on the cloud path, and this mirrors the pre-existing teacher-route pattern) but worth a one-line debt note if a future error type starts including raw history.
- INFO | all reviewed paths | No new CRITICAL/HIGH found. Verified independently (not just re-trusting the file's own "Outcomes" section): `ai.generate` permission matrix matches spec exactly (owner/principal/admin/admissions/teacher; accountant/exam_controller/student/guardian excluded); `pickAssistantProvider` never calls cloud for `local_only`/`local_with_cloud_fallback`, and `streamCloudAgent`/`getGroqModel`/`getGeminiModel` are only reachable on the cloud branch (rule 6 — local never instantiates a cloud provider); `buildReadTools` re-checks `hasPermission` + `isModuleEnabled` per tool, function-typed permissions excluded (fail closed); `navigate` enum is built only from `navItemsFor`, output href is always `/${slug}${item.href}` (no open redirect); `createTask` only `safeParse`s `RecordInsightActionSchema` with `status: "planned"` and never calls an action; `stopWhen: stepCountIs(6)`, `maxOutputTokens: 1024`, `toolCallConcurrency: 1` present on both local and cloud branches; `checkLimits`/`logUsage`/concurrency-slot accounting preserved verbatim in the extracted `cloud-stream.ts`; `UIMessagePartSchema` caps text parts at 4000 chars and 50 parts/50 messages, denies `file`/`source-url`/`source-document`/`reasoning-file`/`data-*` parts (forged tool-result injection blocked); nonce-delimited `<data-{nonce}>` wrapping present; sources are code-built only (`SourceLog`, never model text) and only attached on the `finish` part; student assistant route untouched, stays separate and local-only (D32); route gate order matches spec exactly (cross-site → body cap → Zod → tenant context → `ai.generate` → module → provider → tools → stream).

## Counts

CRITICAL: 0 · HIGH: 0 (2 found+fixed in a prior pass, re-verified fixed) · MEDIUM: 1 · LOW: 2

Known, not a finding: `tests/unit/assistant-catalog.test.ts` → "every catalog name is a defined query" fails on `mastery.heatmapBySection` until M20 merges into this lane.

## Outcomes (controller)
- MEDIUM duplicate ADR id: fixed — M24 decision renumbered D46 -> D47 (decision log header, DBT-99 reference, task-8 report). M22 keeps D46.
- LOW x2: accepted, no change (aggregate flag is human-judged, tracked as DBT-101; cloud-stream logs an already-redacted error, same as the existing teacher route).
