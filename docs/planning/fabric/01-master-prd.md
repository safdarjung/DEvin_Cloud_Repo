# 01 — Fabric master PRD

Status: Phase 0 (2026-10-31). Normalizes `source/vision-2026-10-31.md` (canonical) into feature ids `FB-<AREA>-<nn>`. One table per vision section. Bullets grouped into one row where tightly related; every bullet represented somewhere. Non-feature/meta vision sections (§20 feature-map diagram, §21 implementation-priority stages, §22 differentiators, §24 register) are not rowed here — §21 stages feed `03-roadmap-and-tracker.md`'s release-phase column, §20/22/24 are context only.

AREA set: CORE, ID, AI, MEM, AGT, DATA, INT, TWIN, MKT, STU, EDU, DASH, WS, PAI, FIN, ENG, TRUST, COM, UX.

## §23 — What must never be confused with an implemented feature (verbatim)

| Concept | What it really means |
|---|---|
| AI insight | A generated explanation supported by relevant data |
| Predictive model | A model with measured predictive performance |
| Digital twin | A structured model connected to real, appropriately updated information |
| What-if simulator | An explicit scenario model with defined assumptions |
| Autonomous agent | A tool-using system operating within enforceable permissions |
| Personal memory | User-controlled information that can be inspected and managed |
| Self-improving AI | A measured, controlled improvement process, not an unrestricted self-modifying system |
| Marketplace installation | A module that actually installs, configures and passes compatibility checks |
| Custom Studio delivery | Software built, tested, reviewed and deployed through controlled procedures |

A dashboard can demonstrate all these concepts; the real product requires the underlying data, logic, infrastructure, integrations, safeguards and evaluation. Every Fabric row below is `simulated` (vision §23 holds) until its tracker row says `limited` or `live`.

Columns below: **id** · **feature** · **user roles** · **expected behaviour** · **deps** · **acceptance**.

## §1 — The overall Fabric platform → CORE

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-CORE-01 | Unified identity & account foundation | all | Single identity system backs every product: users, orgs, institutions, households | FB-ID-01 | `profiles` + `memberships` support >1 account type without schema fork |
| FB-CORE-02 | Reusable AI & agent infrastructure | all | Core AI gateway, model routing, agent runtime shared across every domain pack, not education-specific | FB-AI-01, FB-AGT-01 | Same `src/lib/ai/gateway.ts` call signature works for ≥2 domain packs |
| FB-CORE-03 | Shared knowledge, search, retrieval, memory services | all | Knowledge/search/memory live in Core; domain packs consume, never reimplement | FB-MEM-01, FB-DATA-03 | A non-education pack reuses the `personal_memories` schema unmodified |
| FB-CORE-04 | Workflow & automation infrastructure | owner, principal, admin | Workflow engine (triggers, nodes, approvals) is domain-agnostic | FB-AGT-02 | `workflows` table has no school-specific columns |
| FB-CORE-05 | Analytics, forecasting, recommendation, simulation interfaces | staff roles | Shared interfaces for insight/forecast/simulate reused by every pack | FB-INT-01..06 | Insight-card component renders for 2 distinct domains from the same props shape |
| FB-CORE-06 | Notifications & activity history | all | Cross-product notification + activity log, not school-only | — | History table carries no hard `student_id`/`class_id` columns |
| FB-CORE-07 | Module & feature management | owner, platform admin | Install/enable/disable features per org independent of code deploy | FB-MKT-04 | Disabling a module hides its nav/routes without a redeploy |
| FB-CORE-08 | Audit trails, observability, security, administration | owner, admin, platform admin | Append-only audit + observability built into Core, inherited by every pack | FB-TRUST-01, FB-TRUST-05 | `audit_events` exists before the first domain-pack table ships |
| FB-CORE-09 | Subscription, entitlement, billing foundations | owner, platform admin | Billing primitives (plans, entitlements, usage events) live in Core | FB-COM-01 | One entitlements table gates feature access for ≥2 products |
| FB-CORE-10 | Reusable interfaces & APIs for future products | platform admin | Core exposes stable internal APIs a new domain pack builds on without touching Core | — | A second domain pack ships without modifying `src/lib/**` |
| FB-CORE-11 | Multi-industry domain-pack architecture | platform admin | Education, Personal AI, Households, SMB, Healthcare, Professional services, Finance, Other — each an independently versioned pack on shared Core | FB-CORE-01..10 | ≥1 non-education pack directory exists under `src/modules/` with its own owner, schema, permissions |
| FB-CORE-12 | Modular architecture: install/activate/disable/upgrade/rollback + dependency & compat checks | owner, platform admin | Customer config + custom modules sit on top of shared Core | FB-MKT-01..06 | `module_installs.status` enforces `pending_approval→installed↔disabled→uninstalled` |

## §2 — Identity, accounts, workspaces, permissions → ID

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-ID-01 | Universal identity accounts | all | Individual, org, institution, household accounts; multiple memberships; invitation/onboarding; account recovery | FB-CORE-01 | A user holds 2 memberships across 2 institution types without data collision |
| FB-ID-02 | Personal vs institutional workspace separation | all | Personal workspace (`user_id` only, no `institution_id`) distinct from institutional workspace (tenant RLS); explicit action required to cross | FB-MEM-01 | `personal_memories` has no `institution_id` column; RLS denies institution read without an explicit share flag |
| FB-ID-03 | Leaving an institution: real data/auth boundary | all | Membership deactivation revokes institution access; personal rows and settings stay; confidential institution records never copy into the personal workspace | FB-ID-02 | `boundaryPreview()` (Phase 1) / definer fn (Phase 2) clears `is_shared_with_institution` without copying rows |
| FB-ID-04 | Fine-grained permission system | owner, admin | Resource-, data-, and action-level permissions; temporary and delegated access; agent- and integration-specific scopes | FB-CORE-01 | `requirePermission(ctx, perm)` rejects an action whose permission the caller's role lacks |
| FB-ID-05 | Permission governance: reviews, revocation, audit history | owner, admin | Scheduled permission reviews, explicit revocation, full grant/change audit trail | FB-ID-04, FB-TRUST-01 | A `permission_reviews` row transitions `due→reviewed/revoked` and appears in `audit_events` |

## §3 — Fabric AI and intelligence infrastructure → AI

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-AI-01 | Multi-model intelligence abstraction | platform admin | Provider-independent routing, capability registry, cost/latency tracking, fallback models, evaluation-based selection, versioning | FB-CORE-02 | Swapping the configured provider changes zero call sites outside `src/lib/ai/gateway.ts` |
| FB-AI-02 | Hybrid local + cloud AI | owner, admin | On-device model for private/offline tasks; cloud model for complex/long-context tasks; explicit split, not left to UI | FB-AI-01 | `local_only` policy never instantiates a cloud provider (enforced, not convention) |
| FB-AI-03 | Intelligent model routing | owner, admin | Routing weighs privacy, consent, cost, latency, device capability, model quality before choosing local vs cloud | FB-AI-02 | A request flagged restricted never reaches a cloud provider, verified by `tests/security/*` |
| FB-AI-04 | Universal AI conversational interface | all | NL input, context-aware conversation, file/doc interaction, authorised-record search, structured answers, recommendations, follow-up | FB-AI-01 | A follow-up message in the same thread resolves a pronoun from the prior turn without re-stating context |
| FB-AI-05 | AI tool invocation & agent handoff | owner, principal, admin | AI can call a tool, hand off to a specialist agent, or start a workflow, each permission-checked | FB-AGT-01, FB-AGT-02 | A tool call the AI makes is rejected when the caller lacks the tool's permission |

## §4 — Memory and personalisation → MEM

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-MEM-01 | Personal memory | all | Preferences, goals, facts, working context; user can inspect, correct, delete, export; retention settings | FB-ID-02 | A memory item the user deletes is unrecoverable and absent from the next retrieval |
| FB-MEM-02 | Institutional memory | staff roles | Org knowledge, policies, historical records, department knowledge, approved docs, decision history, permission-gated retrieval | FB-ID-04 | A staff query retrieves only memory items their role is permitted to read |
| FB-MEM-03 | Personal contextual memory (learning mechanism 1) | all | Memory shapes AI responses without training a model | FB-MEM-01 | Two users with different stored preferences get different AI phrasing for the same prompt |
| FB-MEM-04 | Local adaptation / LoRA (learning mechanism 2) | platform admin | Lightweight per-tenant or per-user adaptation where practical, explicit consent required | FB-AI-02 | Adaptation is disabled by default and requires a recorded consent row before activation |
| FB-MEM-05 | Shared model improvement, opt-in (learning mechanism 3) | platform admin | Federated learning / differential privacy / secure aggregation; private conversations never default into shared training data | FB-MEM-01, FB-TRUST-03 | A conversation enters shared training only with an explicit, revocable consent row |

## §5 — Agents, automation, workflow workforce → AGT

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-AGT-01 | AI agents (specialist roles, tools, permissions, memory) | owner, principal, admin | Agent directory with role description, tool/permission scope, model tier, activity history, task status, human handoff | FB-ID-04, FB-AI-01 | `agent_definitions.max_risk_class` caps every run from that agent (enforced at insert) |
| FB-AGT-02 | Workflow automation | owner, principal, admin | Visual builder: triggers, schedule/event execution, conditional branches, approval gates, retry/timeout, failure handling, versioning | FB-CORE-04 | Editing a published workflow creates a new `version` row, never mutates the old one |
| FB-AGT-03 | Agent workforce management | owner, principal, admin | Directory, availability, task queue/assignment/dependencies, parallel work, monitoring, cost/error tracking, quality scores | FB-AGT-01 | Agent cost and error rate for a 30-day window are queryable per agent |
| FB-AGT-04 | Safe autonomous actions (risk classes) | owner, principal, admin | `read_only → low_risk_reversible → user_confirmed → human_approved → prohibited`; a run above an agent's ceiling is rejected | FB-AGT-01 | A `human_approved`-class run stays `awaiting_approval` until a permitted approver acts (definer fn) |

## §6 — Data, knowledge and integrations → DATA

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-DATA-01 | Data infrastructure | platform admin, owner | Ingestion, validation, normalisation, transformation, mapping, sync, dedup, quality scoring, lineage, versioning, retention, export, deletion, import | FB-CORE-01 | A duplicate record is flagged by the dedup check before it is written |
| FB-DATA-02 | Integration platform | owner, admin | APIs, webhooks, file import/export, third-party connectors (read-only and read/write), scoped permissions, health monitoring, failed-sync handling, revocation | FB-ID-04 | Revoking a connector's permission stops its next scheduled sync without deleting prior synced data |
| FB-DATA-03 | Knowledge infrastructure | all (permission-aware) | Document library, org + personal knowledge base, semantic search, summarisation, classification, permission-aware retrieval, source references, freshness, conflict handling | FB-MEM-01, FB-MEM-02 | A search result always carries a source reference the user can open |

## §7 — Intelligence, insights, forecasting, recommendations → INT

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-INT-01 | Descriptive intelligence | staff roles | Live summaries, dashboards, trends, period comparisons, team performance, utilisation, exception/data-quality warnings, KPIs, drill-down | FB-CORE-05 | Every KPI card drills down to its underlying record list |
| FB-INT-02 | Diagnostic intelligence | staff roles | Unusual-pattern detection, possible reasons, contributing factors, recurring problems, evidence vs hypothesis labelling | FB-INT-01 | A diagnostic insight separates "evidence" from "hypothesis" in its rendered fields |
| FB-INT-03 | Predictive intelligence | staff roles | Demand/workload/capacity/financial forecasting, risk prediction, trend projection, early warning, confidence range, accuracy tracking | FB-INT-01 | A forecast card always shows a confidence range, never a bare point estimate |
| FB-INT-04 | Prescriptive intelligence | staff roles, owner, principal | Recommended actions with rationale, estimated benefit/cost, options compared, constraints, responsible person, tracked follow-up, measured outcome | FB-INT-03 | `insight_actions` records expected outcome at decision time and actual outcome once measured |
| FB-INT-05 | What-if simulation | owner, principal | Adjustable assumptions, multiple scenarios, baseline comparison, projected outcomes, risk/constraint surfacing, sensitivity analysis, confidence range, save/revisit, human approval before implementation | FB-INT-03 | A scenario cannot move to `approved` without an `approver` distinct from its creator |
| FB-INT-06 | Continuous outcome measurement | owner, principal | Tracks decision rationale, expected vs actual result, forecast accuracy, recommendation usefulness, flags ineffective workflows | FB-INT-04 | A measured outcome updates the originating insight's recorded accuracy via a new row only |

## §8 — Digital twin of a person or organisation → TWIN

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-TWIN-01 | Institutional twin | staff roles | Students, teachers, departments, classrooms, buildings, timetables, facilities, resources, activities, finances, workflows, capacity, history, dependencies — connected graph | FB-DATA-01, FB-INT-01 | Changing one twin node's load recomputes dependent nodes within the same snapshot |
| FB-TWIN-02 | Personal twin | all | Goals, schedule, tasks, preferences, resources, habits, projects, commitments, knowledge, progress; user-controlled, never undisclosed profiling | FB-MEM-01 | A personal twin node is visible and editable only by its owning user |
| FB-TWIN-03 | Twin interface | staff roles | Visual graph, connected entities/relationships, resource/capacity maps, activity/dependency views, historical/current/scenario state, forecast overlay, drill-down to evidence | FB-TWIN-01, FB-INT-05 | Selecting a twin node shows its 2-hop connected nodes and a drill-down link to source records |
| FB-TWIN-04 | Twin simulation | owner, principal | Change one variable, model related effects, compare scenarios, detect resource conflicts, estimate consequences, show uncertainty, save versions, compare simulated vs actual | FB-TWIN-01, FB-INT-05 | A twin scenario run flags a resource node exceeding 100% utilisation as a conflict |

## §9 — Marketplace and module ecosystem → MKT

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-MKT-01 | Marketplace catalogue | all | Industry/productivity modules, AI agents, workflow packs, analytics modules, integrations, custom apps, templates, reporting/simulation packs | FB-CORE-11 | Catalogue lists ≥1 item of ≥5 of the 10 category kinds |
| FB-MKT-02 | Marketplace discovery | all | Categories, search, filters, recommendations, featured/new/popular, customer-specific suggestions, compatibility/dependency/permission display, pricing | FB-MKT-01 | Filtering by category returns only modules of that `ModuleCategory` |
| FB-MKT-03 | Module detail page | owner, admin | Problem solved, intended users, features, screenshots/demos, inputs/outputs, required permissions/integrations, dependencies, supported products, pricing, version, update history, support, reviews | FB-MKT-01 | A module detail page lists its `required_permissions` before install is offered |
| FB-MKT-04 | Marketplace lifecycle | owner, admin | Install, configure, request approval, activate, disable, uninstall, upgrade, rollback, monitor, renew, manage permissions | FB-MKT-01 | `module_installs.status` only moves through the defined state machine, enforced by trigger |
| FB-MKT-05 | Marketplace monetisation | owner, platform admin | Free, paid, monthly, annual, usage-based, custom dev fees, maintenance fees, licensing/revenue share | FB-MKT-01, FB-COM-04 | A module's `pricing.model` determines which entitlement check runs at install |
| FB-MKT-06 | Custom module ecosystem | platform admin | A module built for one org can, with ownership/IP/consent, become reusable; customer confidentiality protected | FB-MKT-01, FB-STU-07 | A module's vendor and confidentiality terms are recorded before it is listed for a second customer |

## §10 — Custom Studio → STU

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-STU-01 | Studio intake | owner, principal | NL requirements: problem, desired outcome, roles, existing systems, integrations, constraints, budget range, timeline, success criteria | FB-AI-04 | `studio_requests.budget_range` and `success_criteria` required before intake is marked complete |
| FB-STU-02 | AI requirements analysis | platform admin | Resolve via existing functionality → configuration → combining modules → new integration → new module → platform change, in that order | FB-STU-01, FB-AI-01 | `interpretRequest()` returns one of the 6 resolution paths, never skips the cheaper options |
| FB-STU-03 | Studio proposal | owner, principal | Clarified requirements, proposed solution, features/workflows, UX outline, technical/integration/permission requirements, cost/timeline estimate, risks, acceptance criteria | FB-STU-02 | A `studio_proposals` row is versioned; a revision creates a new version, not an overwrite |
| FB-STU-04 | AI-assisted development | platform admin | Generate specs, isolate tasks, delegate to coding agents, build, test, security-check, check compatibility, document, stand up a demo environment | FB-STU-03, FB-AGT-01 | A studio build task runs in an isolated branch/worktree, never against `main` directly |
| FB-STU-05 | Studio review and delivery | owner, principal, platform admin | Preview, customer review, human engineering review, security approval, permission review, deployment approval, controlled release, versioning, monitoring, rollback | FB-STU-04, FB-TRUST-01 | Delivery requires a recorded human engineering-review approval before deploy |
| FB-STU-06 | Studio interface | owner, principal | Original request, AI interpretation, clarifying questions, proposed solution, dev status, agent activity, testing status, review findings, cost (est. vs actual), delivery status, installed module + updates | FB-STU-01..05 | Studio UI shows estimated cost next to actual cost once building starts |
| FB-STU-07 | Reusable engineering | platform admin | No unmaintainable per-customer codebases; reusable isolated modules with supported interfaces and explicit data boundaries | FB-STU-04 | A module built via Studio has its own module directory and owner, not inline in a customer-specific file |

## §11 — CoolSkool: complete education product → EDU

One row per §11.x subsection; full bullet lists and acceptance detail live in `docs/planning/coolskool/03-feature-matrix.md` (letter-sections A–H), not duplicated here.

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-EDU-01 | Admissions and enrolment | admissions, principal, guardian | Inquiry → application → offer → enrolment pipeline | matrix §C | Every `F-ADM-*`/`F-WEB-*` row in matrix §C reaches its target Demo status for its Phase |
| FB-EDU-02 | Student information system | admin, principal, teacher | Core student records, profiles, academic history | matrix §B | Every `F-STU-*` row in matrix §B reaches its target Demo status for its Phase |
| FB-EDU-03 | Parent and guardian management | admin, guardian | Guardian accounts, student linkage, access scope | matrix §B | Guardian-linkage rows in matrix §B reach their target Demo status |
| FB-EDU-04 | Teacher and staff management | admin, principal | Staff records, roles, HR | matrix §E | Every `F-HR-*` row in matrix §E reaches its target Demo status for its Phase |
| FB-EDU-05 | Attendance | teacher, admin, principal | Daily/period attendance capture and reporting | matrix §D | Every `F-ATT-*` row in matrix §D reaches its target Demo status for its Phase |
| FB-EDU-06 | Academics and curriculum | teacher, admin | Subjects, curriculum units, sections | matrix §D | Every `F-ACA-*` row in matrix §D reaches its target Demo status for its Phase |
| FB-EDU-07 | Timetable and scheduling | admin, teacher, principal | Class/teacher timetable generation and conflict detection | matrix §D | Timetable-related rows in matrix §D reach their target Demo status |
| FB-EDU-08 | Homework and assignments | teacher, student, guardian | Assignment creation, submission, tracking | matrix §D | Homework-related `F-ACA-*` rows in matrix §D reach their target Demo status |
| FB-EDU-09 | Assessments and examinations | exam_controller, teacher | Exam scheduling, marks, results, report cards | matrix §D | Every `F-EXM-*` row in matrix §D reaches its target Demo status for its Phase |
| FB-EDU-10 | Learning mastery and student progression | teacher, principal | Mastery tracking derived from assessments/homework | matrix §F | Every `F-INT-*`/`F-AI-*` row in matrix §F reaches its target Demo status for its Phase |
| FB-EDU-11 | Student wellbeing and support | teacher, principal, guardian | Signals support qualified-staff review; AI never autonomously diagnoses or decides | matrix §B | Wellbeing signal surfaces to a human reviewer, never auto-acts; no dedicated matrix section yet |
| FB-EDU-12 | School communication | admin, teacher, guardian | Announcements, messaging, parent-communication drafts | matrix §C | Every `F-COM-*` row in matrix §C reaches its target Demo status for its Phase |
| FB-EDU-13 | Fees and financial operations | accountant, guardian, principal | Fee structures, invoices, receipts, payments; real processing needs a secured integration, not a demo button | matrix §E | Every `F-FIN-*` row in matrix §E reaches its target Demo status for its Phase |
| FB-EDU-14 | School operations and facilities | admin, principal | Library, inventory, hostel, canteen, visitor management | matrix §G | Every `F-SVC-*` row in matrix §G reaches its target Demo status for its Phase |
| FB-EDU-15 | Transport | admin, guardian | Routes, stops, vehicle/fee linkage | matrix §G | `F-SVC-02` reaches its target Demo status for its Phase |
| FB-EDU-16 | School administration and reporting | owner, principal, admin | Cross-cutting reports, audit, platform ops | matrix §A, §H | Every `F-IDN-*`/`F-PLT-*` row in matrix §A/§H reaches its target Demo status for its Phase |

## §12 — CoolSkool intelligent dashboard and UX → DASH

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-DASH-01 | Principal dashboard | principal | Enrolment, admissions pipeline, attendance, academic performance, mastery, support alerts, staff availability, timetable issues, fee collection, resource utilisation, events, AI brief, approvals, risks, next actions | FB-CORE-05, FB-INT-04 | Principal dashboard renders ≥10 of the 15 listed widget kinds for the demo tenant |
| FB-DASH-02 | Teacher dashboard | teacher | Today's timetable, classes, attendance, homework, assessments, progress/gaps, students needing review, lesson-planning aid, class insights, comm drafts, pending grading, workload | FB-DASH-01 | Teacher dashboard's timetable is derived from the real schedule, not a static mock |
| FB-DASH-03 | Parent (guardian) dashboard | guardian | Children's profiles, attendance, progress, homework, results, report cards, announcements, fees/payments, teacher comms, meeting requests, learning recommendations | FB-DASH-01 | Guardian dashboard shows only their own linked children's records |
| FB-DASH-04 | Student dashboard | student | Timetable, homework, assessments, progress, mastery, resources, goals, practice, feedback, achievements; age-appropriate safeguards | FB-DASH-01 | Student dashboard hides any field flagged restricted for the student role |
| FB-DASH-05 | Other-role dashboards | admissions, accountant, exam_controller, admin | Role-appropriate views for admissions, academic coordinators, finance, HR, ops, counsellors (restricted), IT admins, owners | FB-DASH-01 | Each listed role sees a dashboard whose widget set differs from every other role's |
| FB-DASH-06 | Smart widgets | staff roles | ~20 named widgets (pulse, funnel, heatmap, queue, conflicts, workload, collection, utilisation, briefing, risk, approvals, agent activity, outcomes, data-quality) each answering what/why/next | FB-DASH-01 | Every widget's props include a "what happened / why it matters / next action" field set |
| FB-DASH-07 | Dashboard personalisation | all | Rearrangeable widgets, configurable layouts, saved views, role defaults, filters/time ranges, drill-down, cross-dashboard nav, mobile/desktop, widget permissions, saved reports | FB-DASH-01, FB-DASH-06 | A layout change persists in `dashboard_layouts` keyed by user × institution × role |

## §13 — CoolSkool intelligence workspaces → WS

14 named workspaces (§13 table) plus §13.1 insight-to-action and §13.2 AI briefings.

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-WS-01 | Command centre | owner, principal | Overall school operations and priorities workspace | FB-DASH-01 | Workspace renders from `demo/command.ts` fixtures |
| FB-WS-02 | Learning & academics | teacher, principal | Curriculum, mastery, assignments, assessments workspace | FB-EDU-06, FB-EDU-09, FB-EDU-10 | Workspace renders from `demo/learning.ts` |
| FB-WS-03 | Student success | teacher, principal, guardian | Student profiles, progress, interventions workspace | FB-EDU-02, FB-EDU-11 | Workspace renders from `demo/success.ts` |
| FB-WS-04 | School operations | admin, principal | Timetable, staffing, transport, facilities workspace | FB-EDU-07, FB-EDU-14, FB-EDU-15 | Workspace renders from `demo/operations.ts` |
| FB-WS-05 | Fees & finance | accountant, principal | Collections, receivables, budgeting workspace | FB-EDU-13 | Workspace renders from `demo/finance-intel.ts` |
| FB-WS-06 | Insights & early warning | staff roles, principal | Trends, predictions, anomalies, recommendations workspace | FB-INT-01..04 | Workspace renders from `demo/insights.ts` |
| FB-WS-07 | What-if simulator | owner, principal | Assumptions, scenarios, comparison workspace | FB-INT-05 | Workspace renders from `demo/simulator.ts` |
| FB-WS-08 | School digital twin | owner, principal | Relationships among people, places, resources, workflows workspace | FB-TWIN-01..04 | Workspace renders from `demo/twin.ts` |
| FB-WS-09 | AI workforce | owner, principal | Agents, workflow execution, approvals workspace | FB-AGT-01..04 | Workspace renders from `demo/agents.ts` |
| FB-WS-10 | Marketplace | owner, admin | Modules, agents, integrations, templates workspace | FB-MKT-01..06 | Workspace renders from `demo/marketplace.ts` |
| FB-WS-11 | Custom Studio | owner, principal | Customer-requested software and integrations workspace | FB-STU-01..07 | Workspace renders from `demo/studio.ts` |
| FB-WS-12 | Personal AI | all | Individual AI experience separate from institutional context | FB-PAI-01..05 | `/me` workspace renders from `demo/personal.ts` |
| FB-WS-13 | Data & integrations | admin, owner | Connectors, data quality, lineage workspace | FB-DATA-01..03 | Workspace renders from `demo/data.ts` |
| FB-WS-14 | Trust & governance | owner, admin | Roles, permissions, audit, privacy workspace | FB-TRUST-01..05 | Workspace renders from `demo/trust.ts` |
| FB-WS-15 | Insight-to-action | staff roles | Pattern, evidence, sources, date range, confidence, factors, reviewer, actions, approval, follow-up, outcome | FB-WS-06, FB-INT-04 | An insight card's "take action" control opens the related class/record + workflow, not a dead link |
| FB-WS-16 | AI briefings | principal, teacher, accountant, admissions, admin | Daily/weekly briefings per role, unresolved issues, changes, risks, priorities, linked to supporting data | FB-WS-01, FB-INT-01 | Every briefing item links back to its source record or insight |

## §14 — Personal AI as an independent Fabric product → PAI

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-PAI-01 | Personal AI assistant | all | Tasks, reminders, goals, planning, documents, knowledge search, summaries, projects, automation, insights, follow-up | FB-AI-04, FB-MEM-01 | Assistant answers a task-status question from the user's own `personal_goals`/tasks data |
| FB-PAI-02 | Personal knowledge system | all | Personal document/knowledge store, searchable, permission-scoped to the owner | FB-DATA-03, FB-MEM-01 | A personal knowledge item is retrievable only by its owning user |
| FB-PAI-03 | Personal intelligence | all | Goal/progress tracking, planning, time/task analysis, scenario comparison, recommendation history, measured outcomes | FB-INT-04, FB-INT-06, FB-TWIN-02 | A personal recommendation's outcome is measured and stored against the original recommendation |
| FB-PAI-04 | Personal AI continuity | all | Independent account, personal subscription, institution-sponsored access, portable preferences, continuity after leaving, explicit sharing | FB-ID-02, FB-ID-03, FB-COM-02 | Personal AI preferences and memory remain intact after a membership is deactivated |
| FB-PAI-05 | Personal + institutional AI together | all | One identity, separate contexts that never silently mix confidential information | FB-ID-02, FB-PAI-04 | No institution-context AI call reads `personal_memories` without an explicit share flag set |

## §15 — Finance and institutional financial intelligence → FIN

Fabric-level Finance industry domain pack (distinct from CoolSkool's own `FB-EDU-13` fees/finance).

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-FIN-01 | Financial intelligence (Finance domain pack) | owner, principal | Financial-analysis product domain for the Finance industry pack | FB-CORE-11 | A Finance-pack financial-intelligence screen exists under its own `src/modules/<finance-pack>/` |
| FB-FIN-02 | Investment research | owner | Research tooling for the Finance pack | FB-FIN-01 | Research screen cites a source per claim, no bare numbers |
| FB-FIN-03 | Portfolio and risk intelligence | owner | Portfolio analytics and risk intelligence for the Finance pack | FB-FIN-01 | Risk metric shown has a defined calculation documented alongside it |
| FB-FIN-04 | Trading progression | owner, platform admin | Staged path: research → portfolio/risk analytics → backtesting → paper trading → limit/risk-monitored broker integration; never a generic agent tool for real-money trades | FB-FIN-03, FB-AGT-04, FB-TRUST-01 | Real-money execution requires `human_approved` risk class, a kill switch, and a reconciliation log before it can run |

## §16 — Fabric's adaptive product and engineering capabilities → ENG

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-ENG-01 | Customer-facing continuous improvement | platform admin | Monitor workflows, measure outcomes, find bottlenecks/repeated manual work, suggest improvements, track, recommend modules | FB-INT-06, FB-MKT-02 | A detected repeated-manual-work pattern produces a module recommendation with supporting evidence |
| FB-ENG-02 | Engineering-agent workflow | platform admin | Research, architect/high-risk reviewer, specialist planners, coding agents (incl. local execution), independent QA, independent security review, integration verification, human approval | FB-AGT-01, FB-AGT-04 | A code change from an engineering agent cannot merge without a recorded independent security-review pass |
| FB-ENG-03 | Software development automation | platform admin | Automated spec-to-code-to-test pipeline for Studio and platform work | FB-STU-04, FB-ENG-02 | A generated module ships with its own test file before review |
| FB-ENG-04 | Isolated engineering execution | platform admin | Branches, worktrees, isolated environments, parallel coding, controlled merges, CI gates, rollback, human production approval | FB-ENG-02 | A rollback restores the prior deployed version without manual file surgery |
| FB-ENG-05 | Self-improving agent harness | platform admin | Optimise instructions/tool use/planning/verification; benchmark and compare harness versions; reproducible, regression-protected; never rewrites or deploys production itself | FB-ENG-02, FB-ENG-04 | A harness-version comparison is reproducible from a recorded benchmark seed, and no harness run holds prod-deploy permission |

## §17 — Security, privacy, governance and reliability → TRUST

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-TRUST-01 | Security | owner, admin, platform admin | AuthN/authZ, tenant isolation, encryption, credential handling, API access control, validation, rate limiting, abuse prevention, dependency/supply-chain security, backup, incident response, monitoring | FB-ID-04, FB-CORE-08 | `tests/security/*` isolation suite passes for every tenant table |
| FB-TRUST-02 | AI security | platform admin | Prompt-injection protection, untrusted-document isolation, tool permissions, sandboxing, secret protection, output validation, allowlists, restricted execution, logging, evaluation, human approval | FB-AI-01, FB-AGT-04 | A document fetched from an untrusted source is treated as data and cannot change the agent's permission scope |
| FB-TRUST-03 | Data governance | owner, admin | Classification, ownership, access policies, retention, export, deletion, consent, lineage, personal/institutional boundary, integration scopes, training-data governance | FB-DATA-01, FB-ID-02 | Every tenant table's data-sensitivity class is documented and enforced by its RLS policy |
| FB-TRUST-04 | AI governance | owner, admin, platform admin | Explainability, evidence/sources, confidence, model versions, recommendation history, human review, overrides, appeals, auditability, bias/quality evaluation | FB-AI-01, FB-INT-04 | An AI recommendation carries model version + confidence and is overridable with a recorded reason |
| FB-TRUST-05 | Reliability | platform admin | Monitoring, error tracking, performance, model latency/cost, integration health, backup verification, DR, deployment monitoring, rollback, availability | FB-CORE-08, FB-ENG-04 | A failed sync or agent run is visible in a health dashboard within 5 minutes of occurring |

## §18 — Commercial, subscription and customer management → COM

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-COM-01 | Organisation subscriptions | owner, platform admin | Org-level plans, billing cycles, entitlements | FB-CORE-09 | An org's active plan determines which entitlement-gated features its members can use |
| FB-COM-02 | Personal subscriptions | all, platform admin | Individual-level plans independent of any institution | FB-CORE-09, FB-PAI-04 | A personal subscription continues after the user's institution membership ends |
| FB-COM-03 | Institution-sponsored personal AI | owner, platform admin | Institution pays for members' Personal AI access, revocable without deleting personal data | FB-COM-01, FB-COM-02, FB-PAI-04 | Ending institution sponsorship downgrades, not deletes, the member's personal AI plan |
| FB-COM-04 | Custom development revenue | platform admin | Studio engagements billed by scope/fee structure | FB-STU-03, FB-COM-01 | A `studio_requests` row records its agreed cost basis before building starts |
| FB-COM-05 | Customer administration | platform admin | Org/customer account administration: plans, usage, support, lifecycle | FB-COM-01 | Platform admin views a customer's plan, usage, and support history in one screen |

## §19 — The Fabric and CoolSkool interface experience → UX

| id | feature | roles | behaviour | deps | acceptance |
|---|---|---|---|---|---|
| FB-UX-01 | Design system | all | Premium technology-company look, consistent components, desktop/tablet/mobile, accessible typography/contrast, light/dark, clear hierarchy, empty/contextual/loading/success/warning/error states | FB-CORE-01 | Every Fabric page renders correctly in both light and dark mode |
| FB-UX-02 | Navigation and interaction | all | Sidebar, routing, breadcrumbs, global search, quick actions, notifications, profile/workspace switching, demo role switching, filters/sort, searchable tables, forms+validation, confirmation dialogs, modals, export, interactive charts | FB-UX-01 | Every Fabric nav item resolves to a real route, none a dead link |
| FB-UX-03 | Interactive prototype behaviour | all | Add/edit/view student, mark attendance, create homework/assessment, draft parent comms, view fees, filter marketplace, install/uninstall demo modules, create studio proposals, change simulation params, compare scenarios, configure agent workflows, review permissions, export reports, switch roles, cross-screen search/nav | FB-UX-02 | Each listed action dispatches a real store intent or navigation, never a no-op |
| FB-UX-04 | Persistent demonstration data | all | Browser storage or mock data service: created students, attendance changes, assignments, installed modules, proposals, workflow configs, widget changes survive navigation and refresh | FB-UX-03 | Reloading after a demo edit shows the edited state, not the original fixture |
| FB-UX-05 | Prototype integrity | all | Every control acts: navigate, open workflow, save/update demo data, filter, export, run local simulation, or open a clearly labelled future-integration demo; never silent no-op or fake success | FB-UX-03, FB-UX-04 | No control in the Fabric UI shows a success toast without a corresponding state change |

## Row count

CORE 12 · ID 5 · AI 5 · MEM 5 · AGT 4 · DATA 3 · INT 6 · TWIN 4 · MKT 6 · STU 7 · EDU 16 · DASH 7 · WS 16 · PAI 5 · FIN 4 · ENG 5 · TRUST 5 · COM 5 · UX 5 = **125 rows**.
