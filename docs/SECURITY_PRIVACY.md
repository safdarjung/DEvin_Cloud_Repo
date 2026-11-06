# Security and privacy

Authoritative design: docs/planning/coolskool/07-security-and-ai-governance.md. This file lists what is verified in code.

## Controls (verified)
- Two-layer authorization: RLS on tenant tables + `requirePermission` in every action. Permission matrix only in src/lib/auth/permissions.ts. proxy.ts is session refresh only.
- Tenant scope: every tenant table has institution_id; actions re-verify membership.
- Result envelope; Zod parse before handler (defineAction).
- Immutable history: payments, receipts, results, marks, audit_events (DB triggers).
- Audit: `src/lib/audit.ts`.
- Service-role client limited to seed/reset, job runner, allow-listed callers (SERVICE_ROLE_CALLER env present).
- AI boundary: gateway only; local_only never loads a cloud provider (policy.ts is pure); redaction in src/lib/ai/redact.ts; usage logged in ai_usage_events (no INSERT policy).
- Secret scan in CI (gitleaks, secrets.yml). No secrets in repo; .env.example has names only.
- Noindex: tenant layout and (auth) layout set robots index:false. robots.txt is advisory, not a boundary.
- Public lead form: honeypot, 16 KB cap, Zod + SQL re-validation, rate limit in SQL (per hashed IP: see migration; 60-min window; per email+kind: 24 h window), IP stored hashed only. Table has RLS on, no policies, grants revoked from anon/authenticated.
- JSON-LD output escapes `<`.
- Service worker never caches api, login, portal, tenant paths.

## Tests
tests/security (13 files) generated RLS isolation, BOLA, escalation, grants, draft leakage, cloud egress. Recorded green on main (e.g. M15 gate: 2225 passed). They need local Supabase (CI only here). Not re-run on this branch.

## Privacy
- Student and guardian data are personal data of minors/families. Cloud AI use is per-institution policy; `local_only` keeps data off cloud providers.
- Gemini path for the teacher agent (D28) is separate from institution policy: it sits outside local_only/cloud_allowed (providers.ts comment). Treat as a data-egress point when GEMINI_API_KEY is set.
- Legal pages (/legal/privacy, terms, cookies, data-processing, acceptable-use) exist as marketing pages; they are product copy, not reviewed by counsel (unverified; get legal review).
- No DPDP Act compliance claim is made or verified here.

## Known gaps
- No custom HTTP security headers (CSP, X-Frame-Options, HSTS) configured in next.config.ts or src.
- No error monitoring, no health endpoint.
- Per-process AI concurrency semaphore (DBT-02) is not a global lock.
- DBT-36: OLLAMA_BASE_URL not asserted to be private/loopback.
- Razorpay webhook and payments run in test mode only.
- No penetration test or third-party audit exists in the repo.

Last verified: 2026-11-06 against branch feat/fabric-public-wave1
