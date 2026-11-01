Packet: Admissions AI enquiry-reply draft
Files changed:
  src/lib/auth/permissions.ts
  tests/unit/permissions.test.ts
  docs/planning/coolskool/07-security-and-ai-governance.md
  src/modules/ai/prompts/enquiry-reply.ts (new)
  src/modules/ai/enquiry-reply.schemas.ts (new)
  src/app/api/ai/enquiry-reply/route.ts (new)
  src/modules/ai/components/EnquiryReplyDraft.tsx (new)
  src/modules/admissions/components/EnquiryDetail.tsx
  src/app/(tenant)/[institution]/admissions/enquiries/[id]/page.tsx
  tests/unit/enquiry-reply-prompt.test.ts (new)

Behavior: admissions role granted ai.generate. New route drafts a reply/call-note
from grade/stage/enquiry-notes-text via runStructured (denyNames: child+guardian
name, never phone), nonce-delimited data block mirroring quiz.ts. EnquiryDetail
shows "Draft a reply" -> editable textarea + ProviderBadge + honesty line ->
"Save as note" calls existing addEnquiryNote action (admissions.enquiry.write).

Tests run: pnpm test -> 406 passed (37 files), pnpm lint -> clean.
Tests not run: test:db, test:security, test:e2e, db:types (not DB owner this round).
Typecheck: pnpm typecheck has pre-existing failures only in src/modules/exams/*
(not touched by this packet, another owner's files) — zero errors in any file
this packet changed.

Honesty label: ProviderBadge + "AI draft — edit before saving" shown while editing;
saved note has no special marking (same reasoning as quiz: human-saved = their content).
New dependencies: none.
Assumptions: "enquiry message text" = enquiry.notes[].text (public-submission
message + any staff notes), since enquiries has no separate message column.

Fix round 1 (security review):
MED-1: denyNames widened past exact full-name match. Added buildDenyNames()
in src/modules/ai/prompts/enquiry-reply.ts — splits each name into
whitespace tokens (>=2 chars), dedupes, denies full names + tokens.
src/lib/ai/redact.ts untouched. route.ts uses buildDenyNames(childName, guardianName).
MED-2: unbounded notes->prompt size capped. Added capNotesMessage() in same
file — joins non-empty note texts, keeps last MAX_MESSAGE_CHARS=4000 chars
(most recent contact matters most for a reply draft; mirrors T-036's
output-token budgeting rationale).
Tests: extended tests/unit/enquiry-reply-prompt.test.ts with buildDenyNames
(token match, dedupe, drops 1-char tokens) and capNotesMessage (null on
empty, join+skip-blank, cap at MAX_MESSAGE_CHARS keeping tail) cases.
Verify: pnpm test -> 430 passed (40 files, includes other packets' concurrent
new tests); pnpm lint clean; pnpm typecheck clean (repo-wide, zero errors now).
