Packet: F-BE-19 Laya visual router
Files changed: .env.example, src/app/api/ai/genui-route/route.ts (new), src/modules/fabric/router/questions.ts (new), src/modules/fabric/router/use-visual-route.ts (new), tests/unit/fabric-router.test.ts (new)
Behavior implemented: Route resolves tenant + institution membership via getTenantContext, requires ai.generate, validates body (state ≤2000, ≤6 noul questions, instructions ≤300), calls LAYA_BRIDGE_URL with 2s timeout. Any bridge failure (env unset, timeout, non-200, bad JSON) → 200 {ok:true,data:null}, never 5xx. Auth/validation failures still use normal ActionResult codes (401/403/422). Hook fetches once per (institution,state,candidates) key via derived requestKey, AbortController cancels on unmount/change; picks highest-noul candidate ≥0.5 else candidates[0].
Tests run: `pnpm exec vitest run --project unit tests/unit/fabric-router.test.ts` → 9/9 pass. `pnpm exec eslint` on all 4 touched files → clean.
Tests not run and why: `pnpm test` (full suite) — pre-existing unrelated failures in tests/unit/nav.test.ts (missing /fabric/learning,operations,students pages — another packet's WIP, not touched here).
Limitations / honesty label: no badge needed — Laya picks a UI shape, never shown as AI-authored content. Not an LLM call, so CLAUDE.md rule 6 gateway.ts boundary doesn't apply (assumption, recorded here).
Security / integration risks: bridge is localhost-only by design (no TLS); never logs state or env values, only payload failures silently swallowed.
Follow-ups: none identified.
New dependencies (justification): none.
Assumptions made: route schema inline in route.ts (not a modules/ai schemas.ts file) since packet named only 4 files; success response shape is `{ok:true,data:<answers>|null}` directly (not wrapped), matching "ANY failure ... data:null" literally; `pnpm typecheck` run but not blocking — failures are in unrelated fabric nav pages outside this packet's file list.
