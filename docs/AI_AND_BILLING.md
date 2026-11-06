# AI and billing

## Gateway (src/lib/ai)
Files: gateway.ts (runStructured, streamAgent), policy.ts, providers.ts, pricing.ts, redact.ts, usage.ts, ui-message-schema.ts. All model calls go through the gateway (project rule 6).

## Policy (per institution)
`local_only` | `cloud_allowed` | `local_with_cloud_fallback`, resolved by pure `resolvePlan` in policy.ts:
- local_only: plan ["local"], cloud never in plan.
- cloud_allowed: ["cloud"] if AI_CLOUD_ENABLED and key set, else ["local"].
- local_with_cloud_fallback: local first, cloud appended only if configured.

## Providers
- Local: Ollama via `ai-sdk-ollama` (OLLAMA_BASE_URL, OLLAMA_MODEL; *-cloud tags rejected).
- Cloud: Anthropic via `@ai-sdk/anthropic` (ANTHROPIC_API_KEY; models AI_CLOUD_MODEL_QUALITY / _CHEAP, defaults claude-sonnet-5 / claude-haiku-4-5), lazily imported.
- Teacher agent (D28): separate Gemini path (GEMINI_API_KEY, GEMINI_MODEL) outside institution policy. Groq SDK is a dependency (GROQ_* env); verify usage before relying on it.

## Limits and metering
`ai_usage_events` table logs calls (inserted server-side; no INSERT policy). Limits in usage.ts: institution daily token quota (`settings.ai.daily_token_quota`, default 200000 in core schema defaults), student daily quota, per-user per-minute rate; errors quota_exceeded / rate_limited. Per-process concurrency semaphore. Cost is a USD estimate from pricing.ts (a price table for a few Anthropic model ids; unknown model, e.g. Gemini free tier, reports 0; local is 0). It is an estimate, never a bill.

## AI features present
Routes under /api/ai: agent, attendance-insight, dashboard-briefing, enquiry-reply, genui-route, quiz, report-remark. Plus student study (src/modules/ai), insights, forecasts, agents (human approval required). Output is a suggestion; AI does not write marks, payments, access or welfare decisions.

## Not implemented (grep confirmed in src, scripts, migrations)
- Credits wallet: no table, code or UI. The only "wallet" hits are an icon and a ledger credit/debit column.
- BYOK (bring your own key): none. Keys are platform env vars.
- Speech / TTS / STT: no code.
- Scenario / what-if engine: none; /fabric/simulator is fixture UI.
- Usage billing/invoicing of schools: none. Pricing page says quote-based and AI credits/BYOK are planned and not part of any plan.

## On-device TTS reference (checked 2026-11-06)
WebFetch of https://developers.google.com/edge/mediapipe/solutions/audio/text_to_speech/index on 2026-11-06: MediaPipe Text-to-Speech task, on-device, headless PCM generator (24 kHz mono float32). Lists three models: Kokoro-82M (Apache 2.0), PocketTTS 100M (CC BY 4.0, attribution to Kyutai), Phonon 31M (Apache 2.0; bundle phonon_int8.litertlm about 87 MB, INT8, CPU; en-US only; voices freya, claire, lucas, lukas, sofia). Platforms: Web (@mediapipe/tasks-audio), Android, iOS, Python. The page did not state preview or stable status. "Phonon 2": not found on that page; unverified, and no equivalence to Phonon 31M is claimed. Summary came from a fetch-time model summarisation; re-read the page before any commitment. Nothing in this repo uses it. Language support (English only) matters for Indian-language needs.

## Planned (not implemented)
Credits wallet, BYOK, voice features, scenario engine: product decisions pending; would need new tables, gateway metering and billing provider integration.

Last verified: 2026-11-06 against branch feat/fabric-public-wave1
