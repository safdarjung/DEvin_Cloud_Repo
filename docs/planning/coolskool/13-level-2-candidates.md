# 13 — Level 2 candidates

Level 1 = the 45 packets in `10-backlog-index.md` (demo-ready foundation). Level 2 starts after Level 1 completes: better UX, more features, deeper AI integration. Items here are approved candidates, not yet planned packets; each gets a packet with acceptance criteria when Level 2 is planned.

## L2-01 — Import quizzes from NotebookLM (owner-approved 2026-10-29)

- **What:** a teacher creates a quiz in their own NotebookLM account, copies or exports it, and pastes it into CoolSkool. A parser converts it to `QuizContentSchema`; the teacher reviews and saves it as an assignment draft through `createAssignment` (same path as the AI quiz).
- **Why this shape:** users spend their own NotebookLM free tier; no credentials reach our servers; no dependency on unofficial NotebookLM automation.
- **Rejected alternative:** server-side NotebookLM via the `nlm` CLI or per-user NotebookLM login. Consumer NotebookLM has no public API; the CLI reuses browser Google session cookies. Storing those per user is a credential-exposure and terms-of-service risk, breaks when the UI changes, and would bypass the AI gateway (policy, redaction, quotas, usage log). NotebookLM Enterprise (Google Cloud) has an official API but is paid.
- **Acceptance sketch:** tolerant parser for common pasted formats with unit tests; invalid input → per-question errors; nothing saved without teacher review; no network call to Google from CoolSkool.

## L2-02 — Bring your own API key (owner-approved 2026-10-29)

- **What:** an institution (and later an individual user, per D26's personal workspace) supplies its own model API key — Gemini (has a free tier), Anthropic, or OpenAI. Keys are stored encrypted (Supabase Vault), never shown again after entry, and used only through `src/lib/ai/gateway.ts`, so `ai_policy`, redaction, quotas and usage logging still apply.
- **Data rules per feature:** every AI feature declares the data class it sends.
  - Curriculum-only features (quiz generation; prompts contain no student data, DBT-07) may use free tiers. Free tiers may use submitted data to improve the provider's products; show that in settings.
  - Features with student data (report remarks, summaries, anything with names/marks/attendance) may use only the local model or a paid tier whose terms exclude training on customer data.
- **Fits:** the gateway's provider abstraction (T-035) and Fabric's user-owned credits direction (D26).
- **Acceptance sketch:** key entry and rotation UI behind a settings permission; per-feature data-class table enforced in `resolvePlan`; tests that a student-data feature never routes to a free-tier provider; usage and cost attributed per key.

## L2-03 — Forecasting on the principal dashboard with TimesFM (owner-approved 2026-10-29)

- **What:** forecasts with uncertainty bands for school-level time series, starting with **term fee collections** (expected collections and shortfall), then **school/grade attendance trends**; enquiry volume only once a full admissions season of history exists. Model: Google Research TimesFM (open weights; confirm current version and licence before adoption) run by a Python worker or nightly job on the existing GPU/CPU, writing a `forecasts` table that the dashboard reads under normal RLS.
- **Guardrails:** every series is backtested against simple baselines (seasonal naive, moving average); the dashboard shows TimesFM only where it beats them, else the baseline. Show the band, the data cut-off date, and a "Forecast" label; feed the academic calendar (holidays, exam weeks) as context. Short histories (a new school, the 60-day demo) are labelled low-confidence.
- **Out of scope:** per-student predictions (marks, dropout) — a classification problem with fairness concerns, not time-series forecasting; and causal "what if we change X" questions, which need a separate scenario model (Fabric's simulation work), not a forecast.
- **Acceptance sketch:** reproducible backtest report per series; forecasts regenerated nightly by a job; worker isolated from tenant data except the aggregated series it needs; no PII leaves the aggregate.
