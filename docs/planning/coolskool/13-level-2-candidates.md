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

## Owner-approved extension modules (2026-11-02)

Each is a plug-and-play module under D45 (MOD): own module key, catalog entry, default per row, gated actions/queries/nav.

**Being planned now (task cards `docs/planning/fabric/06-backend-packets/X01..X08-tasks.md`):** X01 `student_leave` + `diary` · X02 `certificates` (bonafide/character/TC print, ID cards) · X03 `library` · X04 `fee_plans` (late fees, instalments, Tally export) · X05 `whatsapp` channel · X06 `exam_seating` (seating plan, admit cards) · X07 `visitors` (visitor log, gate pass, authorized pickup) · X08 `ptm` (PTM slot booking, parent surveys).

**Queued (owner said "keep in mind", not yet planned):**
- `question_papers` — AI question paper generator from the question bank with a blueprint (marks/difficulty/unit mix); teacher edits; print. Needs M11.
- `expenses` — expense/petty-cash entries, vendor bills, approval chain, budget vs actual.
- `rte_quota` — RTE 25% admissions tracking, documents, govt reimbursement claim sheets.
- `grievance` — anonymous complaint / anti-bullying box with escalation + SLA, POSH-ready.
- `house_points` — houses, points, events, sports/clubs, student achievement portfolio.
- `payroll` — salary structures, PF/ESI/TDS, payslips, bank transfer file (large).
- `hostel_canteen` — rooms/beds allocation, mess menu, canteen prepaid wallet (large).
- `branding` — per-school logo/colors/subdomain white-label + full data takeout.
- `website_chatbot` — admissions FAQ bot on the public site (local AI, answers only from published site content), captures enquiries into admissions.
- `parent_assistant` — parent asks about own child; answers only from that child's data via registered queries, cites sources (D32-style isolation).
- `voice_notes` — teacher voice note → parents; optional local transcription; low-literacy parents.
- `lms_lite` — study material per curriculum unit (notes, PDFs, video links), linked to assignments.
- `online_classes` — Meet/Jitsi link per timetable slot + join-based attendance.
- `scholarships` — scheme catalog refreshed by a scraper job from public scholarship portals (e.g. NSP, state portals): respect robots.txt/ToS + rate limits, store source URL + last-checked date, human review before publishing, prefer official data feeds/APIs where they exist; never auto-submit applications on government portals; plus school-level scholarship/concession rules (sibling, staff-ward) and student applications.
- `store` — uniform/book shop: stock, sales billing, receipts.
- `health` — health records, vaccinations, allergy alerts, infirmary visits (sensitive data; human-only decisions).
- `recruitment` — job posts on the school website, applications, interview tracking.
- `appraisal` — classroom observation forms, teacher appraisal cycles.
- `diksha_link` — map curriculum units to open NCERT/DIKSHA e-content links (official open content/APIs only).
- `events` — annual day/sports day: registrations, participants, volunteers, passes.
- `kiosk_display` — TV/notice-board mode: today's timetable, notices, birthdays, house points.
- `teacher_feedback` — anonymous student feedback on teaching, aggregate-only to staff.
- `class_chat` — moderated teacher↔parent messaging (1:1 + class), teacher hours, personal numbers never exposed.
- `late_arrivals` — late-coming register at gate, auto parent alert, monthly late counts.
- `discipline` — incident log, merit/demerit points, parent notification, escalation (human decisions only).
- `homework_load` — section homework load per day shown before assigning; soft daily cap.
- `family_billing` — combined fee statement + single payment across siblings, family discount rules.
- `admission_test` — entrance test slots, marks entry, merit list → offers.
- `newsletter` — monthly newsletter drafted from events/achievements/gallery; AI drafts, human approves.
- `social_posts` — AI-drafted social media posts from school events, approval queue.
- `alumni` — alumni directory, reunions, mentorship (+ donations later).

## AI-first operating vision (owner directive 2026-11-02, later — after V2 + UI integration)

- **Chat-first for every role.** UI stays, but the school-aware assistant (M24) and agents (M22) must let a user finish as many tasks as logically feasible without leaving the chat: create/issue invoices, record payments, mark attendance, draft and publish notices, schedule PTMs, generate reports, etc. Every write still goes through the registered action (permission + module gate + Zod + audit); risky actions (money, marks, access, welfare) are drafted by AI and confirmed by a human in the chat (rule 6). Tool list = registered actions/queries filtered by caller permissions + enabled modules (D41, D45).
- **Student growth, not dependence.** AI shows each student where they are weak (from marks/mastery/assignments) and how to improve: which subjects/units to focus on, a study plan, practice. Coaching style: hints and questions before answers (Socratic), retrieval practice, spaced repetition, self-explanation prompts, reflection ("what did you get wrong and why"). Never just hands out homework answers; tracks effort and progress the student can see.
- **DIY home experiments.** For science/maths topics, suggest safe at-home experiments/activities with household materials, safety notes, age-gated; teacher-reviewable library.
- **Explain everything well.** Visual explanations (mindmaps/charts already, D31; animations/diagrams later), analogies, worked examples; explanation-style presets including ASD-STE100 Simplified Technical English (short sentences, one idea each, controlled vocabulary) alongside existing terse/ELI5/anatomy presets.
- **Teaching-method selection.** Each teacher can choose research-based teaching methods per class/unit (e.g. 5E inquiry, explicit instruction, flipped classroom, project-based, retrieval practice/spaced repetition, Socratic questioning, differentiated instruction); lesson plans, practice and assessments adapt to the chosen method.
- **More AI for every role** (principal briefings/insights M19/M25, teacher drafting M24, admissions follow-ups, finance anomaly explanations, parent assistant, student coach).
- **Virtual school view (needs privacy design first).** A navigable map/3D view showing what each class is doing *now* from the timetable, notices, events — aggregate, schedule-based. **No individual live location tracking of minors**; any per-student presence view needs DPDP consent, guardian-only access to own child, and a security review.

## External repos evaluated (2026-11-02, Opus research)

| Item | Verdict | One-line reason |
|---|---|---|
| google-research/harness2 | maybe-later | Apache-2.0; offline prompt-tuning loop only, frontier-model cost, never on real data |
| google-research/rrsi | maybe-later | Apache-2.0; better than harness2 for tuning against small eval sets; research code, ~2.4M tokens/task |
| wesbos/3d-model-anything | maybe-later | MIT; static empty-room 3D campus tour only (LiDAR device + manual rebuild); never students in captures |
| CopilotKit/OpenIntelligentUI (ex-OpenGenerativeUI, "Jev") | maybe-later (pattern only) | Jev = hosted third-party router → DPDP risk + breaks local_only; keep our Zod block catalog; maybe one sandboxed "interactive explainer" block later |
| h4ckf0r0day/obscura | no | stealth/anti-bot-detection headless browser; no need, wrong signal for a school SaaS |
| amap-cvlab/ABot-Recon | no | weights CC-BY-NC (non-commercial), datacenter GPUs, classroom video = surveillance of minors |
| makecindy/cindy | no | remote-controls phones/PCs holding student data, vendor cloud + analytics on by default |
| Instinct / Open Instinct | no | single-user personal agent; nothing new (our tiered permissions + human approval already) |
| solidcraft | maybe-later | MIT/Apache; 3D CAD authoring for a STEM explainer library, too young (0.x) |
| Genex Desktop | maybe-later | MIT; content-authoring studio only; routes assets via third parties — never student data |
| Lrtta | unidentified | no such project; ask owner (maybe Letta?) |
| antiwork/gumroad | no | MIT but a second Rails/MySQL stack; payments not India-fit; build a small marketplace on our stack if needed |
| whiteboard animation (letuandat131) | maybe-later | CC0 code; single-author, needs own hand assets + job runner; for explainer videos later |
| ManimGX | maybe-later (best spike) | MIT core; Rust/wgpu Manim-compatible engine for AI-written explainer videos; v0.1, sandbox needed, cloud model for codegen |
| HeyGem / Duix.Avatar | no | non-SPDX licence (>1,000 MAU needs discretionary licence, branding), face/voice cloning = biometric + deepfake risk |
| phonon-2 (Fermion Research) | maybe-later | CC-BY-4.0 tiny STT, English only; benchmark on Indian English vs an Indian-language STT for `voice_notes` |
| Letta (letta.com; owner's "Lrtta"?) | to evaluate | open-source stateful-agent/memory framework (ex-MemGPT); check licence, Python server vs our TS stack, and whether it adds anything over our gateway + agent_runs before adopting |
