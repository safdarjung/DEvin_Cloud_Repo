# Common brief — every implementer/reviewer reads this first

Voice: caveman-terse. No filler. Report file = detail; reply ≤4 lines.

## Always
- Read CLAUDE.md, AGENTS.md (Next 16.4 breaking changes → node_modules/next/dist/docs), your packet, only linked spec sections. Targeted reads, no whole-file dumps.
- Load `andrej-karpathy-skills:karpathy-guidelines`. TDD: failing test first.
- Context7 unreachable → installed .d.ts + codebase precedent.
- No state-changing git. npx/dlx blocked. No new deps unless brief says.
- One DB owner at a time (brief says who). Non-owners: no db:reset/demo:reset/seed/db:types/full test:db/supabase cmds; run only own db test file; retry once on transient error.
- types.ts = raw `pnpm db:types`, additions only.
- Ignore lint/typecheck errors only in other packets' files; say so.

## Security lessons (from reviews — apply up front)
1. RLS SELECT = 07 §2.2 matrix, not coarse "all staff". Role helpers can be broader than a row (admin!) → narrower helper.
2. Every user-supplied FK bound to same institution in `with check`; table-qualify policy subquery columns.
3. `app` schema not exposed → public definer wrappers. Anything PostgREST-callable enforces its own rules (role, window, uniqueness, state). Never generic user enqueue/update whose payload service role later runs; payloads built in SQL from rows.
4. Definers: `search_path=''`, qualified names, no dynamic SQL, revoke app.* from everyone, grants explicit, list in 07 §4 definer row.
5. Guard bypass only `request.jwt.claims->>'role'='service_role'` or `session_user='postgres'` — never null uid.
6. Versioned/immutable data: guard checks parent state + same-entity supersede.
7. RLS perf: no per-row SECURITY DEFINER calls; use `col = any((select app.my_*()))` initPlan helpers (P-01, 0020).
8. Money: integer paise / numeric, never float.
9. AI: structured-output strings ≤500 chars, always maxOutputTokens (Ollama 0.15.2 crash); prompt data blocks nonce-delimited.
10. Errors via mapSqlError/AppError; no raw SQL text; no PII in thrown errors/audit.
11. Handlers: content from rows, re-check state at send, active memberships only, idempotent.
12. Honesty badges (rule 7) where simulated/limited.
13. Actions testable: `callAs` + opt-in `vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"))`.
- Single-file test run: `pnpm test:db tests/db/x.test.ts` (no `--`; with `--` the whole project runs).
- Files the seed scripts import (`src/modules/core/schemas.ts`, …) must use relative `.ts` imports, never `@/` — plain node can't resolve the alias; a broken reseed leaves the demo tenant empty (M03).
- New actions need C-03 fixtures in `tests/security/escalation.test.ts` (import the action file + one fixture per action) — the security suite fails otherwise (M03).
- **HOSTED-APPLIED: hosted Supabase holds exactly 0001–0051, 0064–0079, 0082–0086, 0088–0092, 0094, 0095, 0099 (pushed 2026-11-05; 0087 X04, 0093 M20, 0096 M23 are NOT hosted). NEVER edit any of them.** Any fix to their tables/functions/policies goes in a NEW migration numbered 0102 or higher (0100, 0101 taken by the UI session, hosted) (claim it in 10-backlog-index §3) with its own db test.
