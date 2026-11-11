Orb task bridge: design from a read-only pass, 2026-11-11. No files were edited.

Your direction holds. It should extend what already exists rather than add a second path:
- `draft_<action>` tools in `src/modules/ai/kernel/draft-tools.ts`
- `ActionDraftCard.tsx`
- `DRAFTABLE_ACTIONS` (30 actions) and its `DRAFT_DENY` test in `tests/unit/ai-feature-coverage.test.ts`
- agents `RiskClass` and `ACTION_RISK` (13 rows)

The code forces six corrections:
- **C1 Pickers.** These have no registered query: staff, student text search, guardians, timetable rooms/periods/versions, active loans per student, textbooks, study materials, announcements. Some references are natural keys (`library.loan.return.accessionNo`). Some are generated (`finance.payment.record|void.idempotencyKey`). About 120 are "the record being acted on" (`requestId`, `ticketId`). Field names collide across modules: `roomId` (timetable, hostel, exam-seating, facilities), `eventId` (ptm, clubs), `requestId` (exams, duties, facilities, studio), and `itemId`, `planId`, `slotId`, `assignmentId`, `leaveId`. The entity map must therefore be keyed by module.
- **C2 Money cannot be detected from the Zod type.** `money` (`src/lib/schemas/common.ts`) is reused for exam `marksObtained` and `newMarks`. Finance takes rupee decimals; canteen, expenses and payroll take integer `*Paise`. The field kind must come from field name plus module.
- **C3 Roster actions** (`attendance.mark`, `attendance.markPeriod`, `exam.marks.enter`, hostel roll call, `safety.headcount.mark`, `people.staffAttendance.mark`) need every student in `records[]`. The model cannot list a roster, and on cloud it must not: cloud reads are aggregate-only (`queryAllowedOnCloud`). These need a server "intent → input" expander, or the card hosts the existing `AttendanceRegister`, `MarksEntryGrid` and `RecordPaymentDialog`.
- **C4 Errors.** `guardedCall` returns `flatten().fieldErrors`, which has top-level keys only. Nested row errors and `.refine` rules never reach a form generated from JSON schema, so the card needs issue paths from a bridge validation step.
- **C5** `ActionMeta.permission` is null for actions whose permission is a function of input. Their classification row must carry a static visibility permission.
- **C6 Human-only fields.** Enforce them by stripping at proposal creation; do not have the dispatcher reject values equal to the model's. The equality check is unsound (a human can legitimately type "P" or ₹500), it needs stored model values, and it adds nothing because the signed-in user can call the action directly anyway. Also, the AI SDK stream sends the raw tool-call `input` to the browser, so the card must render only from the sanitized tool `output`.

## 1 Inventory
- **Counts (grep, approximate):** about 296 `defineAction` sites in 78 files; about 232 `defineQuery` in 57 query-defs files.
- **Actions/queries per module:** textbooks 17/0, core 15/13, exams 14/20, academics 13/12, clubs 12/4, people 11/9, finance 10/14, study 9/0, ptm 9/6, school-labs 9/3, agents 8/3, fabric 7/4, timetable 7/11, visitors 7/3, website 7/6, duties 7/3, admissions 6/7, insights 6/6, library 6/3, attendance 4/7, helpdesk 4/5, expenses 5/4, forms 5/4, hostel/safety/transport/compliance 5 each, every other module 1–4. Messaging, study and textbooks have no query-defs.
- **Names:** `<prefix>.<entity>.<verb>` or `<prefix>.<verb>`. The prefix often differs from the folder (`exam.`, `assignment.`, `announcement.`, `survey.`, `maintenance.`, `curriculum.material.*`, `data.import.*`). Newer modules use camelCase (`schoolLabs.booking.book`, `studentLeave.request`). Take the module from `meta.module` and the verb from the last segment.

Field kinds (estimates across action and query schema files) and the control each needs:

| Kind | Count | Control |
|---|---|---|
| uuid reference | ≈420 | entity picker |
| generated uuid | `idempotencyKey` | hidden, generated once per card |
| enum | ≈150 | select (radio if ≤5 options) |
| date | ≈80 | native date input |
| datetime | ≈15 | datetime-local in `settings.locale` timezone; `z.coerce.date` emits `{}`, so map by the name rule `*At` |
| rupee decimal | ≈15 | rupee input |
| paise integer | ≈24 | rupee input stored ×100 |
| marks | exams | marks input (rule 6) |
| free text | ≈150 | input (≤200 chars) or textarea |
| arrays of objects | ≈25 (rosters, fee components, papers, questions, website blocks, workflow steps) | custom renderer or repeater |
| natural key | `accessionNo`, email | text plus lookup |
| file | no File fields | uploads are requestUpload → confirmUpload; v1 opens the page |

Pickers and the registered query behind each:
- **Gaps (new query or none):**
  - Student: new `people.searchStudents`, wrapping `listStudents(ctx, query, page)` in `people/queries.ts`, which teacher `findStudent` already uses.
  - Staff: new `people.searchStaff`.
  - Guardian: none; pick the student first, then use `people.getStudentProfile`.
  - Timetable room, period and version: none (timetable is in flight).
  - Active loan for a student: none; `library.overdue` is overdue only.
  - Textbook, study material, announcement: none.
- **Existing queries:**
  - Academics and exams:
    - Class section: `exams.listSectionOptions`; teachers use `academics.listTeachableSections`.
    - Subject: `exams.listSubjectOptions` / `academics.listSectionSubjects`.
    - Unit: `academics.listCurriculumUnits` / `curriculum.sectionUnits`.
    - Grade: `finance.listGradeOptions`.
    - Exam: `exams.listExams`; paper: `exams.getExamWithPapers`; recheck: `exams.listRecheckQueue`.
    - Term: `exams.listTermOptions`; academic year: `finance.listAcademicYears`.
  - Finance: invoice `finance.listInvoicesForStudent`; fee structure `finance.listFeeStructures`.
  - Library and transport: book/copy `library.catalog`; route/stop `transport.routes`; vehicle `transport.vehicles`.
  - Hostel and clubs: hostel room `hostel.rooms`; allocation `hostel.allocations`; club `clubs.list`.
  - Admissions: enquiry `admissions.listEnquiriesByStage`; application `admissions.listApplications`.
  - Stock and labs: inventory item `inventory.stock`; canteen item `canteen.items`; lab `schoolLabs.labs`; expense category `expenses.categories`.
  - Calendar and leave: PTM event `ptm.events`; staff leave `people.pendingLeaveApprovals`; student leave `studentLeave.list`.
  - Operations: ticket `helpdesk.tickets`; maintenance `facilities.maintenanceRequests`; asset `facilities.assets`; duty `duties.types` / `duties.roster`.
  - Forms: form `form.list`; survey `survey.list`.
  - Teaching: diary `diary.forSection`; assignment `academics.listTeacherAssignments`; submission `academics.submissionsForAssignment`; question `questionBank.list`.
  - Other: insight `insights.list`; website page/notice/event `website.list*`.

## 2 Classification
**Location:** one typed map, `src/modules/ai/tasks/catalog.ts`, keyed by action name. This follows the existing convention (escalation `FIXTURES`, `ACTION_RISK`, `DRAFTABLE_ACTIONS`). Do not add a field on `defineAction`: that touches 78 files owned by other sessions, some in flight (rule 10), and puts AI/UI labels into "use server" domain files.

**Hand-written:** a row is a `label` plus overrides. Rule-6 and undo rows are written by hand. Examples:
- `"library.loan.issue": t("Issue a library book")`
- `"finance.payment.record": t("Record a fee payment", { family: "money", humanOnly: ["/amount","/mode","/reference","/receivedAt"], renderer: "finance.recordPayment" })`

**Derived (`src/modules/ai/tasks/derive.ts`):**
- **Group:** the existing `MODULE_GROUP` in `orb-groups.ts`.
- **Mode:**
  - learn: study, ai and practice modules.
  - teach: assignments, lesson plans, question bank, resources, curriculum material.
  - manage: upsert of setup entities (type, category, structure, rule, room, period, settings).
  - create: the action has a body/content/description text field.
  - do: everything else.
- **Risk:** reuse `RiskClass`; no new class is needed.
  - human_approved: void, delete, remove, purge, archive, finalize, publish, close, withdraw, transfer, promote, decide, send, or any array with max ≥50.
  - low_risk_reversible: acknowledge, join, leave, log, toggle.
  - user_confirmed: everything else.
  - prohibited: not in the orb.
- **What each risk class means on the card:**
  - low: one click, can be batch-approved.
  - user_confirmed: approved card by card.
  - human_approved: card by card, with a consequence line and an "I have checked this" box; never in a batch.
- **Rule-6 family (marks, money, access, welfare) and `humanOnly`:**
  - Seed from the `DRAFT_DENY` regex, then prune the entries that are about risk, not rule 6: publish, void, verify, renew, finalize, setup.
  - `DRAFT_DENY` currently blocks `library.loan.renew`, while `ACTION_RISK` calls it low_risk_reversible. That is inconsistent.
  - About 40 rows need hand-written `humanOnly` paths.
  - Prefill is safe for any field that is neither human-only nor generated.
- **Undo:** only these explicit pairs:
  - `transport.assign`/`unassign`, `clubs.join`/`leave`, `clubs.house.assign`/`unassign`, `visitors.pickup.add`/`remove`.
  - `textbook.add`/`remove`, `timetable.substitution.assign`/`cancel`, `ptm.booking.create`/`cancel`, `schoolLabs.booking.book`/`cancel`.
  - `hostel.allocate`/`vacate`, `diary.entry.post`/`delete`, `people.leave.request`/`cancel`, `studentLeave.request`/`cancel`, `duty.swap.request`/`cancel`.
  - Money and marks never get an undo; the card links to the reversal card instead (rule 5).
- **Idempotency:** each proposal executes once (conditional status claim). The card generates `idempotencyKey` once and reuses it on retry.

**Completeness test, `tests/unit/orb-task-catalog.test.ts`** (imports `all-actions`). It fails when:
- a registered action has neither a row nor `excluded: reason`, or a row names an action that no longer exists;
- a `humanOnly` path is missing from the action's JSON schema;
- a rule-6 regex match has no family and is not excluded;
- a `format: uuid` field has no picker kind with a registered query and is not marked generated or context;
- an undo target is not registered;
- an action with a function permission has no `visibleWith`.

Existing unclassified actions go into a frozen `UNCLASSIFIED` list that may only shrink. Any new action outside that list fails CI.

**Excluded from the orb entirely:**
- **The orb's own controls:** `core.module.set`, `core.feature.set`, `core.ai_role.set`, `core.institution.updateSettings`.
- **Access:** `core.member.*` (slice 2 at the earliest).
- **AI approving AI or automation:** `agent.*`, `workflow.run.decide`, `workflow.setStatus`, `workflow.runNow`, `studio.request.decide`.
- **Destructive or bulk structural:** `visitors.purge`, `data.import.*`, `alumni.sync`, `compliance.starter.load`, `core.setup.applyTemplate`, `lifecycle.promote`, `job.requeue`.
- **Plumbing:** `*requestUpload`, `*confirmUpload`, `*readUrl`, `document.getReadUrl`.
- **UI state:** `notification.read`, `messaging.markRead`, `core.dashboard.layout.*`, `core.setup.setProgress`.
- **The person's own answers (integrity):** `study.quiz.submit`, `study.deck.review`, `practice.submitAttempt`, `assignment.submit`, `survey.respond`, `form.respond`.
- **Others:**
  - `safety.alert.send` stays a page button.
  - `finance.payment.createIntent` needs the gateway UI.
  - `briefing.generate` and `insight.explain` are AI generation and belong in Ask.
  - `ai.study.*` are the study chat's own saves.

## 3 Model protocol (Groq ceiling 5,500 tokens)
- **Selection costs no model step:**
  - The server ranks the caller's enabled tasks against the last two user texts with tool-budget scoring (export `groupScores` from `src/lib/ai/tool-budget.ts`; pass each task as a one-tool group).
  - It filters by the orb mode/group the client sends.
  - It puts the top 5 compact signatures in the system prompt inside `<tasks-${nonce}>`, about 35 tokens each, e.g. `library.loan.issue: Issue a library book | accessionNo:text! student:ref! dueOn:date`.
  - Clicking a feature sends `taskHint`, which loads exactly that signature, or opens an empty card with no model call at all.
- **Tools:**
  - `propose_task({task, values, after?})`, about 150 tokens.
  - `find_task({query})`, about 80 tokens, as a fallback like `more_tools`.
  - The cost stays constant however many actions exist; read groups keep using `planToolBudget`.
- **`propose_task` execute (server):**
  - The task must be in the caller's enabled set.
  - Drop human-only and generated keys.
  - Resolve every entity value (text or uuid) through the picker query under the caller's RLS. A uuid the caller cannot see is dropped. One match is prefilled with its display name; several become candidates; none leaves the field empty.
  - Pin guardian `studentId` like `bindStudentId`. Run the roster expanders. Insert an `ai_proposals` row.
  - Return `{kind:"task_proposal", proposalId, view}`, where `view` is the server-built field list plus values plus candidates, so the client never imports Zod schemas.
  - The model gets back only "Card shown: <label>". Resolved names go to the browser, never to the model.
- **Multi-step example:** "mark 8B present except Ravi and send the absence notice".
  - Card 1 is `attendance.mark` with intent `{section:"8B", date:"today", default:"present", except:[{student:"Ravi", status:"absent"}]}`, expanded to the full roster.
  - Card 2 is `attendance.submit` with `after:1`. Its `sessionId` fills from card 1's result, and it stays disabled until card 1 is approved.
  - Card 2 previews "sends absence notice for 1 student", because `submit_attendance` (migration 0014) enqueues `notify.attendance_absence`. There is no separate notice action.
  - At most 5 proposals per turn (`MAX_PROPOSALS`).
- **Prompt-injection containment:**
  - Record text arrives only inside `<data-nonce>` tags, as today.
  - The card title and summary are built by code from the label and resolved names, never from model text.
  - Model-written text is shown in full, with links highlighted.
  - A proposal made after reading free-text records (helpdesk, enquiry, messages, forms) gets a "Suggested after reading <source>" badge.

## 4 Approval card
**Files:** `src/modules/ai/components/task-card/{TaskCard,TaskFields,EntityPicker,Repeater}.tsx` and `renderers.ts`. `ActionDraftCard` delegates to it; `parseDraftToolOutput` stays until the `draft_` tools migrate.

**Behaviour:**
- **Layout:**
  - A summary view (label, risk badge text, resolved values as sentences); Edit expands the form.
  - Buttons: Approve, labelled with the verb ("Issue book"), and Discard.
  - Inline at 640px and wider. On narrower screens and for long forms it opens in a bottom `Sheet`.
- **Controls:** one per field kind (table in §1). `EntityPicker` is a Popover + Command combobox with debounced `/api/v1/query/<picker>`, scoped by sibling fields (section → subject → unit).
- **Errors:** `fieldErrors` plus bridge `issues[{path,message}]` mapped to rows; an error summary with `role="alert"` takes focus.
- **Preview:** for updates with an `id`, show before/after values. About 15 hand-written previews: absence notices count, announcement audience, reminder family count, substitution clash via `timetable.conflicts` (same pattern as `safety.alert.preview`).
- **Result:** a `role="status"` line, a link to the record (per-row `href(result)`, defaulting to the module page), and Undo where a pair exists. Undo is a new proposal and needs one click.
- **Rule-6 renderers:** host the existing form with context preselected and the deciding inputs empty: `RecordPaymentDialog` with the invoice, `MarksEntryGrid` with the paper, `RecheckDecisionForm`. These forms call their own actions, and the bridge records only `ai.proposal.opened`.
- **Accessibility:**
  - Semantic form, fieldset/legend, labels; `aria-describedby` for hints and errors; `aria-invalid`.
  - 44px touch targets; risk is never shown by colour alone; reduced motion respected.
  - Focus moves to the card heading after approve; Esc closes the sheet and restores focus.
- **Server enforcement of human-only fields (option chosen: the model never supplies them):**
  - Stripped in `propose_task.execute`, so the stored row holds none.
  - `ai.proposal.approve` re-checks the task, role, toggles and the target action's gates.
  - The card reads only the tool `output`; a unit test asserts it never reads `part.input`.

## 5 Orb modes and groups
- **Model:** add a mode axis in `orb-groups.ts`: `OrbFeature {key, label, mode: ask|do|create|learn|manage, groupId, kind: ask|task|open, task?, prompt?, href?}`. Today's chips map across: ask → Ask, create → Create, open → page link. Tasks come from the catalog. `OrbView` gets a mode tablist that filters `OrbGroups`; a mode with no features is hidden.
- **Teacher:**
  - Ask: Attendance, Exams, Teaching, Timetable.
  - Do: mark register, mark period, submit register, post diary, message a guardian, request leave, book a lab.
  - Create: lesson plan, assignment, question, quiz, worksheet, report remark.
  - Teach: publish assignment, attach material, section study deck.
  - Manage: PTM slots.
- **Principal, admin, owner:**
  - Ask: everything.
  - Do: approve/reject staff leave, assign substitute, approve student leave, assign maintenance, visitor in/out, gate pass, resolve/dismiss insights.
  - Create: announcement, calendar event, PTM event, form, compliance item, website notice and page draft, club event.
  - Manage: grade/section/subject setup, fee structure (amounts human-only), duty types, expense categories.
- **Accountant:**
  - Ask: Finance.
  - Do: send reminders, record expense; record payment comes in slice 2.
  - Manage: late-fee rules, instalments, budgets.
- **Exam controller:**
  - Do: open/close/reopen marks entry, seating.
  - Manage: create exam, papers, schedule.
- **Admissions:**
  - Do: enquiry stage, assign, note, convert.
  - Create: enquiry reply.
- **Guardian:**
  - Do: child leave request, PTM booking, message a teacher, helpdesk ticket.
  - Create: message draft.
- **Student:**
  - Learn: study plan, log session.
  - Do: join club, helpdesk ticket.
- **Floating launcher:** `AskAiPanel` keeps `/orb?q=`. Add `&task=<action>`, checked against `taskState` on the server, to open a card on arrival. Every surface uses the same bridge.

## 6 Control centre
- **Storage:**
  - Extend `institutions.settings.ai_roles[role]` (`AiRoleConfigSchema` in `core/schemas.ts`) with sparse `modes`, `groups` and `tasks` overrides.
  - Task keys use the regex `^[a-zA-Z][a-zA-Z0-9_.]{1,80}$` and are validated against the catalog in `core.ai_role.set`, which already writes an audit event.
  - Modules and features stay in `settings.modules` / `settings.features`, with RLS unchanged. No new table, no migration.
  - The handlers read and rewrite the whole JSON, so two admins saving at once can lose one write. Serialize saves in the UI now and log a debt item for an atomic jsonb patch function.
- **Precedence:** code default (catalog `defaultOn`) → school override per role → nothing per user. Settings can only narrow access. `guardedCall` still enforces permissions and modules; the kernel and `ai.proposal.approve` enforce AI toggles.
- **`taskState(ctx, role, action)`:**
  - Packet A owns it in `src/modules/ai/tasks/state.ts`, mirroring `capabilityState`.
  - Lock order: excluded > permission > module (including the `requires` chain) > role off > mode off > group off. Then the stored override, then the default.
  - A module turned off locks its tasks and capabilities but keeps their overrides for when it comes back.
- **Page `/[institution]/settings/control-centre`:**
  - Controls: 9 role chips, search across labels, action names and modules, and presets (Ask only, Teacher assist, Office operations, Full orb; each applies one `core.ai_role.set` per role).
  - A tree: module → features (`FEATURE_CATALOG`) → AI capabilities → tasks by mode.
  - Each row has a switch and a "Why off: Library module is off — Turn on" inline fix. Turning a module off shows a confirm listing dependent modules, tasks and capabilities.
  - It reuses `FeatureToggle` and parts of `AiRoleSettings`, and links the old `/settings/modules` and `/settings/ai` pages.
- **Platform operator view: later.** `/platform` is a stub: no cross-tenant read API and no platform settings store, only the `profiles.is_platform_admin` gate. For now, use code defaults plus an `AI_ORB_TASKS` environment kill switch.

## 7 Security
How each threat is controlled:
- **The AI executes a write:** nothing runs without the approve click. Approve is a registered action, `ai.proposal.approve` (permission `ai.chat`, plus a twin `ai.study.proposal.approve` for students). It goes through `guardedCall` (CSRF, Zod, permission), then the target action's own module, permission and RLS gates, called via the registry the way `executeProposals` does it.
- **Model supplies rule-6 values:** stripped at proposal creation, and the completeness test checks the paths.
- **Valid id of the wrong record:** resolved under the caller's RLS, and the card shows real names with a code-built title.
- **Injected record text:** data tags, the provenance badge, no batch approve for human_approved or rule-6 cards, and broadcasts are human_approved with an audience preview.
- **Another user's proposal or another school's:** RLS `created_by = auth.uid()` plus membership, and the route slug must match the row's institution.
- **Replay or double payment:** a conditional `pending → approving` claim, plus the per-card `idempotencyKey`.
- **Stale proposal:** expires after 30 minutes; approve re-checks `taskState`.
- **Other cases:**
  - Preview role: proposals are disabled under `previewRole`.
  - Guardian: `studentId` is pinned and re-verified at approve.
  - The orb cannot switch off its own guards, because core settings, members and agent/workflow decisions are excluded.
- **Rate limits:**
  - 5 proposals per turn.
  - Arrays are capped by Zod.
  - 20 approvals per minute per user, counted in `ai_proposals`.
  - The gateway's `checkLimits` still applies to chat.
- **PII egress:** resolver results go to the browser only; the cloud aggregate-only rule is unchanged.

**Audit events** (no payloads, per `src/lib/audit.ts`), in addition to each action's own event:
- `ai.proposal.created {proposalId, action, usageId}`
- `ai.proposal.approved {proposalId, action, changedKeys}`
- `ai.proposal.discarded`
- `ai.proposal.opened`

The values the model proposed are kept only in `ai_proposals.proposed`, readable by the creator and by `audit.read`, purged after 30 days.

**Never automate:**
- Execution without a click.
- Batch approval of human_approved or rule-6 cards.
- Any AI-supplied value for:
  - marks;
  - payments, refunds, or fine waivers (`waiveFine`);
  - roles or members;
  - health outcome or treatment;
  - behaviour severity, points or category;
  - admissions decisions.
- Safety alerts.
- Approving agent, workflow or studio runs.
- Settings and toggles.
- Purges and imports.
- A student's own submissions and answers.

## 8 Build packets (disjoint files)
- **A — Opus (security, AI gateway):**
  - **New files:** `src/modules/ai/tasks/{types,catalog,derive,entities,signature,resolve-refs,expanders,state,task-tools}.ts` and `proposals.actions.ts`.
  - **Migration** `supabase/migrations/20261028000143_ai_proposals.sql`:
    - Columns: id, institution_id, created_by, action, proposed jsonb (≤8KB), status (pending|approving|approved|discarded|expired|failed), depends_on, result_ref, changed_keys, error_code, expires_at, created_at, updated_at.
    - RLS, a guard trigger like `app.guard_agent_run_update`, and `set_updated_at`.
  - **New queries:** `people.searchStudents` and `people.searchStaff` in `src/modules/people/query-defs.ts`.
  - **One-line edits:** `all-actions.ts`; `handle-chat.ts` (wire the tools; add `mode`/`taskHint` to `ChatRequestSchema`); `tool-budget.ts` (export `groupScores`); `escalation.test.ts` FIXTURES rows.
  - **Tests:**
    - `tests/unit/orb-task-catalog.test.ts`, `orb-task-derive.test.ts`.
    - `orb-task-tools.test.ts`: strip, excluded actions unreachable, guardian pin, cap, prompt within the Groq budget.
    - `tests/security/orb-bridge.test.ts`: other user, cross-tenant, expired, double approve, toggled off, target permission per role.
    - `tests/db/ai-proposals.test.ts`.
  - **Accept when:** the first-slice rows are classified, the frozen list covers the rest, and the estimated Groq request stays ≤5,500 tokens with tasks on.
- **B — Sonnet, with Opus reviewing the approve flow:**
  - **Files:** `src/modules/ai/components/task-card/*`, `ActionDraftCard.tsx`, `orb/{OrbView,OrbGroups,OrbTranscript}.tsx`, `orb-groups.ts`, `orb-chips.ts`, `src/app/(tenant)/[institution]/orb/page.tsx`, `src/components/ask-ai/{AskAiPanel.tsx,suggestions.ts}`.
  - **Tests:**
    - `tests/unit/task-card-fields.test.ts`: paise/rupee/marks kinds.
    - `tests/unit/orb-modes.test.ts`.
    - `e2e/orb-task-card.spec.ts`: 8B register with one absent then submit; library issue; discard; row-level error.
  - Builds against fixtures from A's `types.ts`.
- **C — Sonnet, with Opus review:**
  - **Files:** `src/app/(tenant)/[institution]/settings/control-centre/page.tsx`, `src/modules/core/components/control-centre/*`, `src/modules/core/control-centre/presets.ts`, `core/schemas.ts` (`AiRoleConfigSchema`), `core/actions.ts` (task-key validation in `core.ai_role.set`), `src/lib/nav.ts`.
  - **Tests:**
    - `tests/unit/control-centre-state.test.ts`: lock chain and dependents.
    - Schema tests.
    - A DB test for the settings write and its audit.
    - An E2E: module off → orb features gone, with "why off" shown.
- **Haiku:** label rows only in `catalog.ts`, to empty the frozen list after A merges; Opus reviews family and `humanOnly` rows.

**Merge order:**
1. A0 (`types.ts`, catalog skeleton, completeness test) on day 0.
2. B and C in parallel.
3. A1 (migration 0143, tools, approve).
4. B goes live.
5. C.
6. Haiku rows.
7. Slice 2: rule-6 renderers, after your ruling.

**First slice (50 actions):**
- **Teacher:** `attendance.mark`, `attendance.markPeriod`, `attendance.submit`, `diary.entry.post`, `assignment.create`, `assignment.update`, `assignment.publish`, `curriculum.lessonPlan.upsert`, `questionBank.create`, `exam.remark.save`, `people.leave.request`, `messaging.startThread`, `messaging.send`, `schoolLabs.booking.book`, `ptm.slots.add`.
- **Leadership:**
  - Leave and cover: `people.leave.approve`, `people.leave.reject`, `studentLeave.approve`, `studentLeave.reject`, `timetable.substitution.assign`.
  - Notices and calendar: `announcement.create`, `announcement.publish`, `calendar.event.upsert`, `ptm.event.create`, `website.notice.upsert`.
  - Forms and helpdesk: `form.create`, `form.publish`, `helpdesk.message.reply`, `helpdesk.ticket.update`.
  - Operations and insights: `maintenance.assign`, `compliance.item.create`, `insight.resolve`, `insight.dismiss`.
  - Activities: `clubs.event.create`, `achievement.record`.
- **Accountant:** `finance.reminders.send`, `expenses.record`.
- **Admissions:** `admissions.enquiry.status`, `admissions.enquiry.note`, `admissions.enquiry.assign`.
- **Office:** `library.loan.issue`, `library.loan.renew`, `visitors.checkIn`, `visitors.checkOut`, `visitors.gatePass.create`.
- **Guardian:** `studentLeave.request`, `ptm.booking.create`.
- **Student:** `study.plan.save`, `clubs.join`, `helpdesk.ticket.raise`.

**Files other sessions are changing that this design depends on:** `handle-chat.ts`, `tool-budget.ts`, `capabilities/catalog.ts`, `all-actions.ts`, `escalation.test.ts`, and the study, textbooks and timetable modules. Classify their actions after they land; timetable pickers are deferred.

## 9 Decisions for you (recommended default in each)
1. **Rule-6 families in the orb:** yes, in slice 2, as the existing forms hosted in the card with the deciding fields empty. This needs an edit to `07-security-and-ai-governance.md` and a change to the `DRAFT_DENY` test. Until then they are excluded.
2. **`assignment.grade` score** (drafted by AI today via `grade_suggestions`): make the score human-only in the bridge, with the AI's number shown only as a hint.
3. **`admissions.application.decide`, `lifecycle.transfer`, `lifecycle.withdraw`:** treat them as the "access" family, with the decision human-only.
4. **Defaults for a new school:** Ask and Create on; Do on for staff roles; Manage off; rule-6 off.
5. **Per-user toggles:** no.
6. **Platform operator panel:** later; use the environment kill switch now.
7. **Proposals:** expire after 30 minutes; keep rows for 30 days.
8. **"Approve all":** only when every card in the batch is low_risk_reversible.
9. **Old `/settings/modules` and `/settings/ai` pages:** keep for one release, linking to the control centre.
10. **Student and guardian Do mode:** only the limited set above, and never submissions or answers.
11. **`safety.alert.send`:** excluded; it stays a page button.

Not checked: exact field counts (the table's numbers are grep estimates, not a full schema walk), the RLS policy on `institutions` updates, the full `ROLE_PERMISSIONS` matrix per action, and in-flight `study`/`textbooks`/`timetable` schemas.
Risk: the strip-at-proposal guarantee holds only while the card reads `output` and never `part.input`. Pin that with the test in packet B.
