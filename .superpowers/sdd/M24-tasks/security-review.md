# M24 security review — findings and outcomes

Reviewer is read-only; this file is written by the fix task before any edit, then
appended with outcomes after.

## HIGH — cloud redaction only scrubs `role === 'user'` text; prior local-turn
assistant text (full 38-query catalog, incl. PII) resent verbatim once a later
turn routes to cloud

File: `src/app/api/ai/agent/assistant/route.ts`

`redactUserText()` only scrubs role==='user' text parts before a cloud call;
assistant-role text from an earlier turn answered by the LOCAL provider (full
38-query catalog, including finance/attendance/student PII) is resent
verbatim as conversation history on a later turn once `pickAssistantProvider`
switches to cloud (`cloud_allowed` + `AI_CLOUD_ENABLED=true` routes to cloud
whenever `latestUserText` is non-empty; sending one turn with an
empty/whitespace-only text part trivially forces `'local'` for that turn).
This breaches the stated cloud invariant "no per-person row leaves the
server" (07 §5 L2-02) since a prior local answer can carry real
student/finance data into the unredacted history sent to Groq/Gemini.

Fix: redact every message role's text (not just `'user'`) before the cloud
branch, or stop recomputing provider per-turn from message text and instead
pin/validate that no tool-sourced personal data ever entered history under a
different provider (e.g. tag messages with the provider that produced them
and refuse/strip any non-aggregate-tagged assistant text before a cloud
call).

## HIGH — governance doc claims "section roster names" are redacted; code never
passes `denyNames`

File: `docs/planning/coolskool/07-security-and-ai-governance.md`

§5 "Staff assistant (M24)" bullet claims cloud-path redaction covers "phone,
email, Aadhaar, section roster names", but `redactUserText()` in
`src/app/api/ai/agent/assistant/route.ts` calls `redact(part.text)` with no
`denyNames` argument, so student/staff names are never redacted — only
email/phone/12-digit-ID regexes run. This overstates the actual PII
protection in a governance doc (CLAUDE.md rule 7: docs and UI must agree) and
could mislead a DPDP-Act compliance review.

Fix: either build and pass a real `denyNames` list (e.g. section roster) into
`redact()` for the cloud path, or correct the doc bullet to drop the false
"section roster names" claim.

## LOW — `buildAssistantTools` fixed tool names (`navigate`/`createTask`) can
be silently shadowed by a future catalog entry of the same name

File: `src/modules/ai/assistant/tools.ts`

`buildAssistantTools` spreads `buildReadTools()`'s tool map first, then
unconditionally overwrites `tools.navigate` / `tools.createTask`; a future
registered query literally named `navigate` or `createTask` (no dot, so
`toolNameFor` leaves it unchanged) would silently collide and be shadowed
with no test guarding against it.

Fix: assert no registry name collides with the two fixed tool names (e.g. a
static test like the existing `TOOL_NAME` regex check), or namespace the
fixed tools so collision is structurally impossible.

---

## Outcomes

- **HIGH (redaction scoped to `role==='user'` only) — FIXED.** `redactUserText()`
  in `src/app/api/ai/agent/assistant/route.ts` now maps every message's text
  parts through `redact()` regardless of role, before the cloud branch, so
  an earlier local-turn assistant answer carrying PII is scrubbed the same as
  the latest user turn before it is ever sent to Groq/Gemini on a later
  cloud-routed turn. New failing-first test:
  `tests/unit/assistant-route.test.ts` — "cloud_allowed + AI_CLOUD_ENABLED=true:
  redacts a prior assistant-role text part too (L2-02, not just the latest
  user turn)" (RED before the fix: `redactions` was 0 and the phone number
  passed through verbatim; GREEN after).

- **HIGH (doc overstates redaction to include "section roster names") — FIXED
  (doc corrected, not the smaller of the two offered fixes but the honest
  one).** `docs/planning/coolskool/07-security-and-ai-governance.md` §5 no
  longer claims names are redacted; it now says redaction is phone/email/
  Aadhaar-like-ID only and explicitly notes `redact()` is called with no
  `denyNames`, so names are not pattern-matched. Building a real roster-based
  `denyNames` list was out of scope for this fix task (the route has no
  per-section context to scope a roster to, and a school-wide name list is a
  real new feature, not a surgical fix) — tracked as a follow-up below.

- **LOW (`navigate`/`createTask` collision with a future catalog name) —
  FIXED.** Added a static guard test,
  `tests/unit/assistant-catalog.test.ts` — "no catalog name collides, after
  toolNameFor, with buildAssistantTools' fixed names" — asserting no
  `ASSISTANT_QUERIES` key maps (via the same `.`→`_` substitution
  `toolNameFor` does) to `navigate` or `createTask`. Passes today (no
  existing collision); it will fail the moment anyone adds a colliding
  catalog entry, which is the structural guard the finding asked for. Did
  not namespace the fixed tool names themselves (e.g. `assistant_navigate`)
  since that would be a breaking change to the tool contract the model and
  any caller already see, for a risk that is currently zero and now
  mechanically caught.

### Pre-existing, out-of-scope failure noticed while rerunning the suite

`tests/unit/assistant-catalog.test.ts` → "every catalog name is a defined
query" fails on `mastery.heatmapBySection` — this is the known lane gap
recorded in `task-5-report.md`/`task-7-report.md`: M20 (which registers
`mastery.*` queries) is not merged into lane-j yet. Confirmed present before
and after this fix task's changes; not one of the three findings and not
touched here.

### Tests rerun

- `pnpm test tests/unit/assistant-route.test.ts tests/unit/assistant-catalog.test.ts tests/unit/assistant-tools.test.ts tests/unit/agents-tools.test.ts tests/unit/cloud-stream.test.ts tests/unit/teacher-agent-route.test.ts tests/unit/agent-provider-routing.test.ts` → 100 passed, 1 failed (the pre-existing M20 lane gap above).
- `pnpm test:db tests/db/assistant-acceptance.test.ts` → 5 passed, 0 failed.
- `pnpm test:security tests/security/grants.test.ts` → 9 passed, 0 failed.
- `pnpm lint` (touched files) → clean.
- `pnpm typecheck` (repo-wide, per project convention) → clean.

### Follow-ups

- New debt row for `12-decision-log.md` §Debt: build a real section-roster
  `denyNames` list for the cloud assistant path (needs a way to scope "this
  school's names" without per-section context in this route), then pass it
  into `redact()` for the cloud branch — restores the originally-intended
  name redaction instead of the corrected (narrower) doc claim.
