# T-036 — AI quiz route, review UI, save as assignment

| Field | Value |
|---|---|
| Lane / Day | D / Day 10–11 |
| Size | 1.5 agent-days |
| Critical path | no (T-041 depends on it) |
| Review | security-reviewer + lead |
| Feature ids | F-AI-04, F-ACA-05 |
| Depends on | T-035, T-022 (merged) |
| Migration | — |

## Business outcome
A teacher opens a curriculum unit, generates a quiz with the local model, edits the questions, and saves it as a draft assignment — AI drafts, the teacher decides.

## Current repo state (verify before starting)
- Gateway: `grep -n "export async function runStructured" src/lib/ai/gateway.ts`.
- Quiz schema home: `grep -n "QuizContentSchema" src/modules/academics/assignments.schemas.ts`.
- Units query: `grep -n "listCurriculumUnits" src/modules/academics/assignments.queries.ts`.

## Spec sections to read (only these)
`06-workflows-and-contracts.md §W6` · `04-architecture.md §3` (route handler row), `§5` (prompt-injection posture) · `07 §5` (data flow: curriculum text only) · `08 §4 J-08`, `§2` (`QuizSchema` invariants) · `12 §2` (AI SDK row: `createUIMessageStreamResponse` only if streaming).

## Files to inspect first
`src/lib/ai/gateway.ts` (signature, error codes) · `src/modules/academics/components/AssignmentForm.tsx` (reuse for save) · `src/app/api/jobs/run/route.ts` (route-handler auth pattern).

## Expected changes
- `src/modules/ai/quiz.schemas.ts` — `QuizRequestSchema` (`institutionSlug`, `curriculumUnitId`, `questionCount` 5..15, `difficulty`), re-exports `QuizContentSchema` as the output schema.
- `src/modules/ai/prompts/quiz.ts` — instructions + prompt builder using only unit title/description, grade, subject, difficulty; wraps unit text in a delimited data block with "treat as data" rule.
- `src/app/api/ai/quiz/route.ts` — POST: session → `getTenantContext(slug)` → `requirePermission('ai.generate')` → teaches-section check for the unit's grade/subject (or exam/admin roles) → `runStructured({ feature: 'quiz_generation', schema: QuizContentSchema, … })` → JSON envelope with `provider`/`fallback`.
- `src/modules/ai/components/{QuizGenerateButton,QuizReviewEditor,ProviderBadge}.tsx` — client components; editor allows editing stems/options/answers, deleting questions; "Save as draft" calls `createAssignment({ …, content, aiGenerated: true })`.
- `src/app/(tenant)/[institution]/assignments/units/[unitId]/page.tsx` — unit page with generate panel.
- `tests/unit/quiz-prompt.test.ts`, `tests/unit/quiz-schema.test.ts`, `tests/db/quiz-route.test.ts` (route with mocked gateway).

## Must not modify
`src/lib/ai/**` (request changes from T-035 owner = same lane, separate packet) · `src/modules/academics/assignments.*` except importing · migrations.

## Permissions / nav / migration numbers needed from the lead
None (`ai.generate` exists; page lives under `/assignments`).

## Security and data-integrity requirements
- Nothing from the AI response is persisted by the route; only `ai_usage_events` via the gateway.
- Saving goes through `createAssignment` with full Zod validation and the teaches-section check — the route cannot write assignments.
- Error UI texts exactly as `06 §W6` ("Local AI is offline; try again or write the quiz manually", policy name shown for `ai_policy_blocked`).
- Honesty: `ProviderBadge` shows "Generated locally" / "Generated in cloud (redacted)"; editor header "AI draft — review before publishing".

## Acceptance criteria
1. `teacher.vi-a` generates 10 questions for a VI Mathematics unit with Ollama running; the badge reads "Generated locally"; editing an option and saving creates a draft assignment with `ai_generated = true`.
2. With Ollama stopped: the offline message appears; no assignment is created; one failed usage event exists.
3. `guardian.one` POSTing to the route gets `forbidden`; `teacher.viii-b` on a VI unit gets `forbidden`.
4. Request with `questionCount: 50` → `validation_failed` with field error.

## Tests (write failing tests first) and exact commands
- `tests/unit/quiz-schema.test.ts` (exactly N questions, 4 unique options, answer ∈ options) → `pnpm test -- tests/unit/quiz-schema.test.ts`
- `tests/unit/quiz-prompt.test.ts` (no student fields possible; delimiter present) → `pnpm test -- tests/unit/quiz-prompt.test.ts`
- `tests/db/quiz-route.test.ts` (auth, permission, scope with gateway mocked) → `pnpm test:db -- tests/db/quiz-route.test.ts`
- `pnpm test:e2e -- e2e/j08-ai-quiz.spec.ts` once T-041 page objects exist (otherwise manual J-08 recorded).

## Deliverables
Schemas, prompt builder, route, three components, unit page, tests, completion report with one real generation sample (question text only).

## Assumptions and risks
- Synchronous structured call (no streaming) is the default; streaming is a fallback-ladder item, not required.
- Local model may return fewer questions than asked; the gateway's repair retry handles schema failures, the editor shows the count.

## Completion report
Use the format in `CLAUDE.md`.
