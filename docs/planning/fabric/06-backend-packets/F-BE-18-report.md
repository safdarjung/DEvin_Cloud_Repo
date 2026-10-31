# Packet F-BE-18: Trust Fixtures

**Created:** 2026-10-31

## Implementation

Created `src/modules/fabric/demo/trust.ts` with four deterministic fixture generators:

- `auditEvents(opts)`: 40 events over 10 days, sorted descending by `at`, with roles and events from permission matrix
- `modelRegistry(opts)`: 6 models (Ollama qwen local, Gemini cloud, Groq cloud, Anthropic Haiku cloud, Laya classifier local, GPT-4 retired)
- `consentRecords(opts)`: 10 consent records with mixed granted/not-granted, variable expiration
- `permissionReviews(opts)`: 12 reviews with due/reviewed/revoked statuses, matching real Role union

## Tests

`tests/unit/fabric-fixtures/trust.test.ts`: 21 tests passing.

- Determinism: same seed produces identical output
- Counts: 40, 6, 10, 12 respectively  
- Sorting: audit events descending by `at`
- Strings: all ≤200 chars
- Field presence: all required fields populated

## Verification

```
pnpm typecheck  ✓ (trust.ts, trust.test.ts)
pnpm lint       ✓
pnpm test -- tests/unit/fabric-fixtures/trust.test.ts  ✓ (21/21)
```

## Skipped

No contract edits (types.ts read-only per rules). No new dependencies. Seeded via Rng interface with default 7 when seed omitted.
