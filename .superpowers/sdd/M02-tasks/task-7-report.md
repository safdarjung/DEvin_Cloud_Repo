Packet: M02-T7 Query routes

Files changed:
- src/app/api/v1/query/[name]/route.ts (new) — POST mirrors actions dispatcher (readPostBody + dispatchCall); GET builds body from `institution`/`input` search params, 400 on malformed `input` JSON, no Origin check (GET carries no body).
- src/app/api/v1/query/route.ts (new) — GET = listResponse(request, getQueryMeta()).
- src/modules/ai/student-study-query-defs.ts (new, controller ruling / plan gap) — defineQuery wrappers for listStudyItems, listStudyFolders, getStudyItem from student-study.queries.ts. Names ai.listStudyItems / ai.listStudyFolders / ai.getStudyItem. Permission ai.study (student-only, 07 §2.2, same key task-3-brief uses for ai module student-portal fns — matches this module's only caller, portal/study/** pages).
- src/app/api/v1/query/all-queries.ts (edit) — added `import "@/modules/ai/student-study-query-defs";` line (alphabetical, after ai/query-defs).
- tests/unit/api-query-list.test.ts (new) — mirrors tests/unit/api-actions-list.test.ts: 401 without claims, 200 lists every registered query (asserts people.listStudents / permission student.read / inputSchema.type object), bearer-token passthrough.

Behavior implemented:
GET /api/v1/query lists every registered query (name, permission, JSON input schema), 401 if unauthenticated — identical shape to GET /api/v1/actions. POST /api/v1/query/<name> dispatches like actions. GET /api/v1/query/<name> is query-only sugar: institution + input come from the URL query string instead of a JSON body (input is JSON-parsed; parse failure -> 400 validation_failed). Added the 3 ai.student-study query defs that T3–T6 didn't cover (plan gap per controller instruction), registered in all-queries.ts so the completeness test stays exhaustive.

Tests run:
- `pnpm test tests/unit/api-query-list.test.ts` → RED (confirmed by temporarily removing query/route.ts: import failure) then GREEN, 3/3 passed.
- `pnpm test tests/unit/action-names-unique.test.ts` → 4/4 passed (new ai.* query names registered and unique).
- `pnpm lint` → clean.
- `pnpm typecheck` → clean (next typegen + tsc --noEmit).

Tests not run and why: tests/db/**, tests/security/**, e2e/** — brief is unit-only, no DB; not touched.

Limitations / honesty label: n/a — no UI, no simulated/limited surfaces.

Security / integration risks: GET /api/v1/query/<name> puts `input` in the URL (query string) rather than a request body — acceptable for reads per the brief ("no Origin check needed on GET") but query strings can land in server/proxy access logs; no query input here carries secrets (ids/dates/search strings only), so this matches the risk profile of any other GET with params. ai.* study query defs reuse existing RLS-scoped queries.ts fns unchanged; permission ai.study is student-only per 07 §2.2 — no other role can call these 3 even via the new HTTP surface.

Follow-ups: none identified.

New dependencies (justification): none.

Assumptions made: GET's `input` param absent (not just empty) means `undefined` passed to dispatchCall's Zod schema (so queries with an all-optional/empty schema still validate); only `input` present-but-malformed-JSON returns 400. Controller's "rules as in task-3-brief" for the ai study defs read as: one defineQuery per exported async fn, name `ai.<fn>`, permission `ai.study`, schema shaped from each fn's actual params (listStudyItems' optional filter object flattened to top-level optional fields to match defineQuery's single-input-object convention used throughout T3–T6).
