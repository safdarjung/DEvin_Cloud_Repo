# Known limitations

## Environment / verification
- Local vitest fails to start with `code.charCodeAt is not a function` (pre-existing, environment issue, root cause not investigated). So unit tests could not be re-run on this branch.
- No Docker locally: `pnpm test:db` and `pnpm test:security` run in CI only.
- Not measured: Lighthouse / Core Web Vitals (no Chrome binary), real-device tests, WCAG audit. e2e/a11y.spec.ts and responsive.spec.ts exist but were not run here.
- Hosted-DB state is taken from HANDOFF.md, not checked live.

## Deployment gaps
- No health endpoint, no error monitoring, no custom security headers (CSP, HSTS).
- No rollback automation beyond Vercel redeploy; DB has no down migrations.

## Product gaps
- Email: simulated until RESEND_API_KEY. WhatsApp: simulated until MSG91 keys (always simulated for demo institutions). SMS: simulated only.
- Razorpay: test mode only; live mode unproven.
- 5 /fabric/* pages (Student success, Simulator, Digital twin, Marketplace, Studio) are fixture-backed UI with LimitedBadge; others complete and tested per HANDOFF.md.
- No AI credits wallet, BYOK, speech, or scenario engine.
- Per-role AI settings: `institutions.ai_policy` governs only Anthropic (DBT-157); pre-0108 usage rows have null role (DBT-158); usage sums via PostgREST cap at 1000 rows, fix with SQL aggregate functions (DBT-159).
- Local AI quality depends on the Ollama model; cloud routing follows per-role config (D50) not institution policy alone.
- Pricing is quote-based; no self-serve billing.
- Hosted demo may auto-login visitors (DEMO_AUTO_LOGIN); ensure off for real tenants.

## Code-level debts seen in comments
DBT-02 per-process AI concurrency; DBT-36 OLLAMA_BASE_URL not asserted private; DBT-45 guardian_students RLS recursion (use a definer); RLS/unique violations may surface as `internal` unless mapped. Full list: docs/planning/coolskool/12-decision-log.md.

## Marketing/PWA
- public/sw.js duplicates marketing segment list by hand; keep in sync with src/lib/marketing/routes.ts.
- Root JSON-LD emitted on all routes, including noindexed tenant pages.
- Slugs equal to reserved marketing segments are not allowed for institutions.
- Legal pages are unreviewed product copy.

## Test-flakiness notes
Under parallel stacks vitest 5 s timeout fails spuriously (HANDOFF); rerun with --testTimeout=30000. DBT-46 flaky invoice chunk test.

Last verified: 2026-11-07 against branch ai-roles
