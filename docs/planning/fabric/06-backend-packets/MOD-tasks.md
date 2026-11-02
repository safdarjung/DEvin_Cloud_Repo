# MOD — Core + plug-and-play modules

Source: owner directive 2026-11-02 ("very basic simple core; every complex feature a logically categorised plug-and-play module"); ADR **D45** (`docs/planning/coolskool/12-decision-log.md`). Supersedes the foundation part of `07-master-plan-v1-v2.md` §3 M26 (0052 stays reserved for V3 marketplace commerce). Runs after batch 2 (M08–M14, M17) merges; batch 2 shipped without module keys, so this milestone retrofits them. Migration: one, `20261028000084_module_enabled.sql` (claim in `10-backlog-index.md` §3 at dispatch; next spare 0085–0089 if taken). No new deps, tables, permissions or `ErrorCode`s. New code home: `src/lib/modules/catalog.ts`. Replaces fixture: none (`MarketplaceModule`/`ModuleInstall` in `src/modules/fabric/types.ts` stay fixtures until V3).

Rulings:
- **Catalog.** `src/lib/modules/catalog.ts` has **no imports** (the seed and `pnpm jobs:run` load it under plain node; importers use `../../lib/modules/catalog.ts`-style relative paths from seed-/runner-loaded files, `@/lib/modules/catalog` elsewhere). `MODULES = {…} as const satisfies Record<string, ModuleEntry>`, `ModuleEntry = { label; category: ModuleCategory; description; core?: true; default: boolean; requires?: readonly string[] }`. `ModuleKey = keyof typeof MODULES`; `OptionalModuleKey` = keys without `core`. `MODULE_DISABLED_MESSAGE = "Module not enabled for this school."` lives here too.
- **State.** `institutions.settings.modules.<key>: boolean`, optional keys only (`z.partialRecord(z.enum(OPTIONAL_MODULE_KEYS), z.boolean())`). Missing key = catalog default. Core key or unknown key in settings = Zod error. Only `core.module.set` writes it (`core.institution.updateSettings` omits `modules`).
- **Predicate.** `isModuleEnabled(ctx: { institution: { settings: Record<string, unknown> } }, key)`: core → `true`; else stored boolean ?? default; AND every `requires` (recursive, graph acyclic). SQL mirror `app.module_enabled(p_institution_id, p_key)` returns the same for every key (drift test, T12).
- **Gate order** in `guardedCall`: context → module → Zod → permission → handler. Disabled → `fail("forbidden", MODULE_DISABLED_MESSAGE)` (HTTP 403). Runs on `overrideCtx` too (D34 unchanged).
- **Every** `defineAction`/`defineQuery` declares `module` (core keys included). T13 makes the field required, so `pnpm typecheck` is the completeness check; the registry test asserts the runtime meta.
- **Pages / nav.** Module pages call `requireModule(ctx, key)` → `notFound()`. Shared pages (dashboard, today, portal) skip a disabled module's sections and do not fetch them. `NavItem.module?`; `navItemsFor`/`homePathFor` take `settings`. Fabric showcase items, `/me` and `/api/ai/genui-route` stay ungated (fixtures / fail-safe Laya router).
- **Jobs.** `JOB_MODULES` (in `src/modules/jobs/registry.ts`) maps job type → module; the runner completes a job of a disabled module as succeeded with no side effects (dropped, never retried). Core job types have no row.
- **Channels.** `email`/`sms` channels are not attempted (no `delivery_attempts` row) when their module is off; in-app always runs. `core.member.invite` falls back to `delivery: "simulated"` when `email` is off.
- **Public.** `/api/public/enquiry` → the same 404 as an unknown slug when `admissions` is off. Disabling `website` while the site is live → `conflict` (the public site is served by the anon `get_public_site` RPC, which cannot read settings). The Razorpay webhook is **never** gated: captured money is always recorded (overrides M12-tasks' "ignore when disabled" ruling; only `finance.payment.createIntent` is gated).
- **AI routes.** Route handlers check their module right after context + permission and fail exactly like a missing provider (`ai_unavailable`, D30). Teacher/student agent routes need no edit: `isFeatureEnabled` AND-s the feature's module.
- **Not a security boundary.** RLS, permissions and definer role checks are unchanged; a direct PostgREST RPC is not module-checked. Module off = feature off; data is kept, never deleted, and returns when switched back on.
- **Defaults.** `true` for every module whose code exists when MOD lands (M01–M14, M17); `false` for `scheduled_reports`, `insights`, `mastery`, `forecasts`, `agents`, `workflows`. Demo tenant (seed), `createTestInstitution` and the C-03 context store `allModulesOn()`.
- **Later milestones** (M15+): header names the module key; every new definition sets `module` (type-required); new pages `requireModule`; new nav items `module`; new job types a `JOB_MODULES` row. A key not yet in the catalog is added to `MODULES` (TS) and to `app.module_catalog` via `insert into app.module_catalog (key, default_enabled) values (...) on conflict (key) do update set default_enabled = excluded.default_enabled` in the same task (new migration; the drift test fails otherwise). `app.module_enabled` is defined once by MOD-T12 and is never re-created by a later migration. Tests need no module setup; `tests/security/module-gate.test.ts` covers every new name automatically.

Key map (`on`/`off` = catalog default; folders under `src/modules/` unless a path is given; `a|b` = alternatives sharing a prefix):

| Key | Category | Default | Requires | Owns (folder → action/query names) | Pages · nav · jobs · routes |
|---|---|---|---|---|---|
| `core` | Core | always | — | `core/*` (`core.*`), `imports/*` (`data.import.*`, `imports.*`), `documents/*` (`document.*`, `documents.*`), `jobs/*` (`job.*`, `jobs.*`), `ai/query-defs.ts` (`ai.usageSummary`) | /dashboard, /jobs, /ai/usage, /settings/modules |
| `people` | Core | always | — | `people/actions.ts`, `people/query-defs.ts` (`people.*` incl. M14 `people.student.update`, `people.guardian.update|link`) | /students |
| `academic_structure` | Core | always | — | `academics/setup.actions.ts` (`academics.grade|section|subject|subjectAssignment.*`); `academics.listCurriculumUnits|listTeachableSections|listSectionSubjects`; M10 `curriculum.unit.upsert|delete`, `curriculum.sectionUnits` | — |
| `attendance` | Core | always | — | `attendance/*` daily: `attendance.mark|submit|correct`, `attendance.getTodaySectionsForTeacher|getSession|getStudentAttendanceSummary|attendanceTodaySummary|sectionsBelowThreshold|getSectionAttendancePatterns` | /attendance, /today · job `notify.attendance_absence` |
| `fees` | Core | always | — | `finance/actions.ts`, `finance/query-defs.ts` pre-M12 names (`finance.structure.*`, `finance.invoice.*`, `finance.payment.record`, `finance.list*|get*|termCollectionSummary`) | /finance · job `finance.generate_term_invoices` |
| `notifications` | Core | always | — | `notifications/actions.ts` (`notification.read`), `notification.preferences.set`, `notifications/query-defs.ts` (`notifications.*`) | /notifications, /portal |
| `timetable` | Academics | on | — | `timetable/actions.ts`, `timetable/query-defs.ts` (`timetable.*` except the substitution names); M08 period attendance `attendance.markPeriod`, `attendance.periodSummary` | — |
| `assignments` | Academics | on | — | `academics/assignments.actions.ts` (`assignment.*` incl. M09 `assignment.submit|grade|close`); `academics.listTeacherAssignments|getAssignment|listStudentAssignments|submissionsForAssignment|mySubmissions` | /assignments/**, /portal/assignments · nav /assignments |
| `lesson_plans` | Academics | on | — | M10 `curriculum.lessonPlan.upsert|delete`, `curriculum.lessonPlans`, `curriculum.markCovered`, `curriculum.coverageBySection` | — |
| `question_bank` | Academics | on | — | M11 `question-bank/*` (`questionBank.*`) | — |
| `exams` | Exams | on | — | `exams/*` (`exam.*`, `exams.*` incl. M11 `exam.paper.schedule`, `exams.schedule|scheduleConflicts|reportCardHtml`) | /exams/**, /portal/results · nav /exams, /exams/rechecks · jobs `notify.results_published`, `notify.recheck_decided` |
| `admissions` | Admissions & Website | on | — | `admissions/*` (`admissions.*`) | /admissions/** · nav · `/api/public/enquiry` · jobs `notify.enquiry_received`, `notify.enrolment_welcome` |
| `website` | Admissions & Website | on | — | `website/*` (`website.*`) | /website/** · nav · disable blocked while live |
| `staff_attendance` | People & HR | on | — | M08 `people/staff-attendance.actions.ts`, `people/leave.actions.ts`, `people/hr.query-defs.ts` (`people.staffAttendance.*`, `people.leave.*`, `people.staffAttendanceForDate|staffAvailabilityToday|leaveRequests|pendingLeaveApprovals`) | — |
| `substitution` | People & HR | on | `staff_attendance`, `timetable` | M08 `timetable/substitution.actions.ts` + substitution defs in `timetable/query-defs.ts` (`timetable.substitution.assign|cancel`, `timetable.substitutions|substitutionCandidates|coverNeeded`) | — |
| `student_lifecycle` | People & HR | on | — | M14 `lifecycle/*` (`lifecycle.promote|transfer|withdraw|history`) | — |
| `finance_plus` | Finance+ | on | — | M12 `finance/reversals.actions.ts`, `finance/reminders.actions.ts` (`finance.payment.void`, `finance.reminders.send`), `finance.collectionReport` | job `finance.fee_reminder` |
| `online_payments` | Finance+ | on | `finance_plus` | M12 `finance/online-payments.actions.ts` (`finance.payment.createIntent`) | webhook never gated |
| `facilities` | Operations | on | — | M13 `facilities/*` (`facilities.*`, `maintenance.*`) | — |
| `transport` | Operations | on | — | M13 `transport/*` (`transport.*`) | — |
| `calendar` | Operations | on | — | M13 `calendar/*` (`calendar.*`); SQL `app.block_attendance_on_holiday` | — |
| `announcements` | Communication | on | — | `notifications/announcements.actions.ts` (`announcement.create|publish`) | job `notify.announcement` |
| `email` | Communication | on | — | `email` channel in `notifications/service.ts`; invite email in `core.member.invite` | — |
| `sms` | Communication | on | — | `sms` channel in `notifications/service.ts` | — |
| `scheduled_reports` | Reports | off | — | M15 | — |
| `ai_teacher` | AI | on | — | `/api/ai/quiz`, `/api/ai/report-remark`, `/api/ai/enquiry-reply`; `/api/ai/agent/teacher` via features `teacher_ai_*`; M24 assistant | nav /ai |
| `ai_student` | AI | on | — | `ai/student-study.actions.ts`, `ai/student-study-query-defs.ts` (`ai.study.*`, `ai.listStudyItems|listStudyFolders|getStudyItem`); `/api/ai/agent/student` via features `student_ai_*` | /portal/study/** via features |
| `ai_briefings` | AI | on | — | `/api/ai/dashboard-briefing`, `/api/ai/attendance-insight`; M25 briefings | — |
| `insights` | Intelligence | off | — | M19 | — |
| `mastery` | Intelligence | off | `exams` | M20 | — |
| `forecasts` | Intelligence | off | — | M21 | — |
| `agents` | Intelligence | off | `ai_teacher` | M22 | — |
| `workflows` | Intelligence | off | — | M23 (an `agent` node is skipped while `agents` is off) | — |

Category display order: Core, Academics, Exams, Admissions & Website, People & HR, Finance+, Operations, Communication, Reports, AI, Intelligence.

Routing: T1 haiku none [] ; T2 sonnet none [1] ; T3 haiku none [1] ; T4 sonnet tests [1,2,3] ; T5 haiku none [3,4] ; T6 haiku none [2] ; T7 haiku none [2,3] ; T8 haiku tests [2,3] ; T9 haiku none [2,3] ; T10 haiku none [1,3] ; T11 sonnet tests [1,4] ; T12 sonnet exclusive [1] ; T13 sonnet tests [4,6,7,8,9] ; T14 haiku exclusive [1]

New action `core.module.set`: manifest unchanged (core file) + C-03 fixture. New query `core.modules.list`: `core/query-defs.ts` + smoke sample in `tests/db/api-query-route.test.ts`. Seed-/runner-imported files: relative `.ts` imports only. Retrofit tasks (T6–T9) are mechanical: one `module: "<key>",` line after each `name:` in the files listed, no logic change, exception to the ≤3-files limit.

---

### Task 1: MOD-T1 Module catalog + settings key (Haiku)
READ: BRIEF-COMMON.md; rulings + key map; `src/lib/auth/entitlements.ts` (D33 pattern); `src/modules/core/schemas.ts` (`features` block, `UpdateInstitutionSettingsSchema`); installed `node_modules/zod` `.d.ts` for `partialRecord`
FILES: `src/lib/modules/catalog.ts` (new, no imports); `src/modules/core/schemas.ts` (edit); `tests/unit/modules-catalog.test.ts` (new)
MIGRATION: none
EXPORTS: catalog — `type ModuleCategory` (11 literals, display order above); `MODULES` (33 entries in key-map order; `label` ≤ 40 chars, `description` one plain sentence ≤ 160; core entries `core: true, default: true`); `type ModuleKey`; `type OptionalModuleKey`; `MODULE_KEYS: [ModuleKey, ...ModuleKey[]]`; `OPTIONAL_MODULE_KEYS: [OptionalModuleKey, ...OptionalModuleKey[]]`; `MODULE_DISABLED_MESSAGE`; `isModuleEnabled(ctx: { institution: { settings: Record<string, unknown> } }, key: ModuleKey): boolean` (reads settings defensively like `isFeatureEnabled`); `allModulesOn(): Record<OptionalModuleKey, true>`. schemas — `InstitutionSettingsSchema.modules = z.partialRecord(z.enum(OPTIONAL_MODULE_KEYS), z.boolean()).optional()` (import `../../lib/modules/catalog.ts`; if `partialRecord` is missing or accepts unknown keys, build a strict `z.object` from the keys); `UpdateInstitutionSettingsSchema.settings` = `InstitutionSettingsSchema.omit({ modules: true }).partial()`; `SetModuleEnabledSchema = z.object({ key: z.enum(MODULE_KEYS), enabled: z.boolean() }).strict()` + `SetModuleEnabledInput`.
TEST FIRST: every `requires` entry is an optional key and the graph is acyclic; a core key is enabled even when settings say false; missing key → catalog default (`insights` false, `exams` true); stored false → off; `timetable` off ⇒ `substitution` off although stored true; `finance_plus` off ⇒ `online_payments` off; `{core: true}` and `{nope: true}` fail the `modules` schema; `allModulesOn()` parses; `DEFAULT_INSTITUTION_SETTINGS` still parses; `UpdateInstitutionSettingsSchema` rejects `settings.modules`.
ACCEPT: `pnpm test tests/unit/modules-catalog.test.ts tests/unit/institution-settings.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 2: MOD-T2 Module gate in `guardedCall` (Sonnet)
READ: BRIEF-COMMON.md; rulings (gate order); `src/lib/actions/define-action.ts`, `define-query.ts`, `registry.ts`; `tests/unit/define-action.test.ts`
FILES: `src/lib/actions/define-action.ts`; `src/lib/actions/define-query.ts`; `src/lib/actions/registry.ts`; `tests/unit/define-action.test.ts` (edit)
MIGRATION: none
EXPORTS: `GuardedCallOptions.module?: ModuleKey`; `DefineActionOptions`/`DefineQueryOptions` inherit it optional (T13 makes it required); `ActionMeta.module?: ModuleKey`, filled by both `defineAction` and `defineQuery`. In `guardedCall`, once `ctx` is set (override and resolved branches) and before `safeParse`: `if (opts.module && !isModuleEnabled(ctx, opts.module)) return fail("forbidden", MODULE_DISABLED_MESSAGE);`.
TEST FIRST: action with `module: "exams"` under `{modules: {exams: false}}` → `forbidden` + exact message, handler not called, also for input that would fail Zod; same action with exams on → handler runs; a core key never blocks even with stored settings garbage; `substitution` stored true but `timetable` false → forbidden; `defineQuery` behaves the same; `getActionMeta()`/`getQueryMeta()` carry `module`.
ACCEPT: `pnpm test tests/unit/define-action.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 3: MOD-T3 Features under modules, `requireModule`, nav filter (Haiku)
READ: BRIEF-COMMON.md; rulings; `src/lib/auth/entitlements.ts`; `src/lib/auth/require.ts`; `src/lib/nav.ts`; `src/app/(tenant)/[institution]/ai/page.tsx` (feature labels); `tests/unit/entitlements.test.ts`, `tests/unit/nav.test.ts`
FILES: `src/lib/auth/entitlements.ts`; `src/lib/auth/require.ts`; `src/lib/nav.ts`; one-argument edits in `src/app/(tenant)/[institution]/layout.tsx` and `src/app/(tenant)/[institution]/page.tsx`; `tests/unit/entitlements.test.ts`, `tests/unit/nav.test.ts` (edit)
MIGRATION: none
EXPORTS: `FEATURE_CATALOG` entries gain `module` (`teacher_ai_*` → `"ai_teacher"`, `student_ai_*` → `"ai_student"`) and `label` (reuse the `/ai` page strings; short plain labels for the rest); `isFeatureEnabled` returns `false` first when `!isModuleEnabled(ctx, entry.module)`. `requireModule(ctx: TenantContext, key: ModuleKey): void` → `notFound()` (`next/navigation`). `NavItem.module?: ModuleKey`; tag `/assignments` assignments, `/exams` and `/exams/rechecks` exams, `/admissions` admissions, `/website` website, `/ai` ai_teacher. `navItemsFor(permissions, settings: Record<string, unknown>)`, `homePathFor(permissions, settings)`: drop items whose module is disabled. No new nav item here (T5 adds it with its page).
TEST FIRST: `teacher_ai_agent` false when `ai_teacher` off although the feature is stored true; `student_ai_study` false when `ai_student` off; existing D33 cases unchanged; owner with `{modules: {exams: false}}` gets no `/exams` and no `/exams/rechecks`; default settings → today's hrefs per role (EXPECTED_HREFS unchanged).
ACCEPT: `pnpm test tests/unit/entitlements.test.ts tests/unit/nav.test.ts tests/unit/nav-routes.test.ts tests/unit/nav-fabric.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 4: MOD-T4 `core.module.set` + `core.modules.list` (Sonnet)
READ: BRIEF-COMMON.md; rulings; `src/modules/core/actions.ts` (`setFeatureEnabled` — mirror it); `src/modules/website/queries.ts` (`getWebsite`); `src/modules/core/queries.ts`, `query-defs.ts`; `tests/db/core-actions.test.ts` (fixture pattern)
FILES: `src/modules/core/actions.ts` (new action + `module: "core"` on every existing def); `src/modules/core/queries.ts` (`listModules`); `src/modules/core/query-defs.ts` (register + `module: "core"` on every def); `tests/db/core-modules.test.ts` (new); + C-03 fixture `{ key: "timetable", enabled: true }` + smoke sample `{}`
MIGRATION: none
EXPORTS: `setModuleEnabled = defineAction({ name: "core.module.set", module: "core", schema: SetModuleEnabledSchema, permission: "institution.settings.manage", handler })` — core key → `invalid_state` "Core modules are always on."; enabling while a `requires` key is off → `conflict` "Turn on <labels> first."; disabling while an enabled module requires it → `conflict` "Turn off <labels> first."; disabling `website` while `getWebsite(ctx)?.isLive` → `conflict` "Take the public website offline first."; merge into `settings.modules`, validate with `InstitutionSettingsSchema.shape.modules`, update `institutions`, `audit` `core.module.set` `after: { key, enabled }`, `revalidatePath(\`/${slug}\`, "layout")`, return `{ key, enabled }`. `listModules(ctx): ModuleCategoryGroup[]` (pure, no DB) = `{ category, modules: { key, label, description, core: boolean, enabled, requires: ModuleKey[], options: { key: FeatureKey, label, enabled }[] }[] }[]` in display order; `options` = `FEATURE_CATALOG` entries of that module. Query `core.modules.list`: schema `z.object({}).strict()`, permission `institution.settings.manage`, module `"core"`.
TEST FIRST: admin disables `timetable` → stored false, audit row, `listModules` shows it off; core key → `invalid_state`; disable `timetable` while `substitution` on → `conflict` naming Substitution; enable `online_payments` while `finance_plus` off → `conflict`; live website → `conflict`; teacher → `forbidden`; list has 11 categories, core modules enabled, `ai_teacher` options include `teacher_ai_agent`.
ACCEPT: `pnpm test:db tests/db/core-modules.test.ts tests/db/core-actions.test.ts tests/db/api-query-route.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 5: MOD-T5 `/settings/modules` page (Haiku)
READ: BRIEF-COMMON.md; rulings; `src/modules/core/components/FeatureToggle.tsx`; `src/app/(tenant)/[institution]/ai/usage/page.tsx` (page shape); T4 `listModules`
FILES: `src/app/(tenant)/[institution]/settings/modules/page.tsx` (new); `src/modules/core/components/FeatureToggle.tsx` (edit); `src/lib/nav.ts` (one item); `tests/unit/nav.test.ts` (EXPECTED_HREFS)
MIGRATION: none
EXPORTS: `FeatureToggle` gains optional `kind?: "feature" | "module"` (default `"feature"`); the key prop accepts `FeatureKey | ModuleKey`; kind `"module"` calls `setModuleEnabled`, same `{ key, enabled }` input, same copy. Page: `getTenantContext` → `requirePermission(ctx, "institution.settings.manage")` → `listModules(ctx)`; one `Card` per category; core modules show "Always on" and no button; optional modules render `FeatureToggle kind="module"` + description + "Needs: <labels>" when `requires`; an enabled AI module lists its options as nested `FeatureToggle`s. Nav item `{ href: "/settings/modules", label: "Modules", icon: Puzzle, permission: "institution.settings.manage", group: "Admin" }` inside the Admin run.
TEST FIRST: EXPECTED_HREFS gain `/settings/modules` for owner, principal, admin only; `nav-routes` finds the page.
ACCEPT: `pnpm test tests/unit/nav.test.ts tests/unit/nav-routes.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 6: MOD-T6 Retrofit: people, attendance, finance, notifications, imports, documents, jobs, AI usage (Haiku)
READ: BRIEF-COMMON.md; key map (rows `core`, `people`, `attendance`, `fees`, `notifications`, `timetable`, `staff_attendance`, `finance_plus`, `online_payments`)
FILES: every `defineAction`/`defineQuery` file in `src/modules/{people,attendance,finance,notifications,imports,documents,jobs}/` except `notifications/announcements.actions.ts` (T9); `src/modules/ai/query-defs.ts`. Find them with `grep -lE "define(Action|Query)\(" src/modules/<folder>`.
MIGRATION: none
EXPORTS: one `module:` line per definition, per the key map: imports/documents/jobs/`ai.usageSummary` → `"core"`; `people.*` → `"people"` except M08 HR names → `"staff_attendance"`; daily attendance → `"attendance"`, `attendance.markPeriod`/`attendance.periodSummary` → `"timetable"`; pre-M12 finance → `"fees"`, `finance.payment.void`/`finance.reminders.send`/`finance.collectionReport` → `"finance_plus"`, `finance.payment.createIntent` → `"online_payments"`; notifications → `"notifications"`. No other change.
TEST FIRST: none new (T13's gate test covers it). Self-check: `grep -cE "define(Action|Query)\(" <file>` equals `grep -c "module:" <file>` for each touched file; paste the counts in the report.
ACCEPT: `pnpm test tests/unit/define-action.test.ts tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 7: MOD-T7 Retrofit: academics, timetable, question bank (+ assignment pages) (Haiku)
READ: BRIEF-COMMON.md; key map (rows `academic_structure`, `assignments`, `lesson_plans`, `timetable`, `substitution`, `question_bank`); T3 `requireModule`
FILES: every `defineAction`/`defineQuery` file in `src/modules/{academics,timetable,question-bank}/`; pages `src/app/(tenant)/[institution]/assignments/**/page.tsx`, `src/app/(tenant)/[institution]/portal/assignments/**/page.tsx`
MIGRATION: none
EXPORTS: `module:` per key map (`academics/query-defs.ts` and the M10 curriculum files are mixed — map each name). Each listed page calls `requireModule(ctx, "assignments")` right after `getTenantContext`.
TEST FIRST: none new. Same grep self-check as T6.
ACCEPT: `pnpm test tests/unit/action-names-unique.test.ts tests/unit/nav-routes.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 8: MOD-T8 Retrofit: exams, admissions, website (+ pages, public enquiry) (Haiku)
READ: BRIEF-COMMON.md; key map (rows `exams`, `admissions`, `website`); `src/app/api/public/enquiry/route.ts`; `tests/db/public-enquiry-route.test.ts`
FILES: every `defineAction`/`defineQuery` file in `src/modules/{exams,admissions,website}/`; pages under `src/app/(tenant)/[institution]/{exams,admissions,website}/**/page.tsx` and `portal/results/**/page.tsx`; `src/app/api/public/enquiry/route.ts`; `tests/db/public-enquiry-route.test.ts` (one case)
MIGRATION: none
EXPORTS: `module:` per key map; pages `requireModule(ctx, "<key>")` after `getTenantContext`; the enquiry route adds `settings` to its existing institution lookup and returns its unknown-slug 404 when `!isModuleEnabled({ institution: { settings } }, "admissions")`.
TEST FIRST: enquiry to an institution with `{modules: {admissions: false}}` → 404, no enquiry row, no job.
ACCEPT: `pnpm test:db tests/db/public-enquiry-route.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts tests/unit/nav-routes.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 9: MOD-T9 Retrofit: announcements, student AI, facilities, transport, calendar, lifecycle (Haiku)
READ: BRIEF-COMMON.md; key map (rows `announcements`, `notifications`, `ai_student`, `facilities`, `transport`, `calendar`, `student_lifecycle`)
FILES: `src/modules/notifications/announcements.actions.ts`; `src/modules/ai/student-study.actions.ts`, `src/modules/ai/student-study-query-defs.ts`; every `defineAction`/`defineQuery` file in `src/modules/{facilities,transport,calendar,lifecycle}/`
MIGRATION: none
EXPORTS: `module:` per key map (`announcement.*` → `"announcements"`, `notification.preferences.set` → `"notifications"`). No page edits (portal study pages are gated through `isFeatureEnabled`; batch 2 added no pages).
TEST FIRST: none new. Same grep self-check as T6.
ACCEPT: `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 10: MOD-T10 Shared pages + AI routes (Haiku)
READ: BRIEF-COMMON.md; rulings (pages, AI routes); `src/app/(tenant)/[institution]/{dashboard,today,portal}/page.tsx`; `src/app/api/ai/{quiz,report-remark,enquiry-reply,dashboard-briefing,attendance-insight}/route.ts`; `tests/unit/teacher-agent-route.test.ts` (route mock pattern)
FILES: the 3 pages; the 5 routes; `tests/unit/ai-route-modules.test.ts` (new)
MIGRATION: none
EXPORTS: pages — each fetch of an optional module's data (exams, admissions, website, assignments, timetable, calendar, transport, …) runs only when `isModuleEnabled(ctx, key)` and its section is not rendered otherwise. Routes — after context + permission: quiz, report-remark, enquiry-reply check `"ai_teacher"`; dashboard-briefing, attendance-insight check `"ai_briefings"`; disabled → the response the route already returns when no provider is configured (`ai_unavailable`).
TEST FIRST: quiz route with `ai_teacher` off → `ai_unavailable`, no gateway call; dashboard-briefing with `ai_briefings` off → `ai_unavailable`; with modules on, both reach the (mocked) gateway.
ACCEPT: `pnpm test tests/unit/ai-route-modules.test.ts tests/unit/teacher-agent-route.test.ts tests/unit/student-agent-route.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 11: MOD-T11 Jobs + channels (Sonnet)
READ: BRIEF-COMMON.md; rulings (jobs, channels); `src/modules/jobs/{registry,runner}.ts`; `src/modules/notifications/service.ts` (M17 `emailChannel()`); `core.member.invite` in `src/modules/core/actions.ts`; `tests/db/jobs.test.ts`, `tests/db/notifications-email-channel.test.ts` (fetch-spy pattern)
FILES: `src/modules/jobs/registry.ts`; `src/modules/jobs/runner.ts`; `src/modules/notifications/service.ts`; `src/modules/core/actions.ts` (`inviteMember` only); `tests/db/module-jobs-channels.test.ts` (new)
MIGRATION: none
EXPORTS: `JOB_MODULES: Readonly<Partial<Record<string, ModuleKey>>>` — `notify.results_published`/`notify.recheck_decided` → exams, `notify.enquiry_received`/`notify.enrolment_welcome` → admissions, `notify.announcement` → announcements, `finance.fee_reminder` → finance_plus, plus any other batch-2 job type per the key map (core types: no row). `createRunnerPorts.dispatch`: when the type has a row (`Object.hasOwn`) and `job.institution_id` is set, read `institutions.settings` with `admin`; disabled → return without calling the handler (job completes succeeded). `service.ts`: drop `email`/`sms` from the channel list when their module is off (settings read with the client the function already holds); relative `.ts` imports. `inviteMember`: email sends only when the existing condition holds AND `isModuleEnabled(ctx, "email")`; else `delivery: "simulated"`.
TEST FIRST: `notify.announcement` job for an institution with `announcements` off → job `succeeded`, zero notifications; with it on → notifications created; `email` off with `RESEND_API_KEY` stubbed → no `email` delivery attempt and no fetch to api.resend.com, in-app row present; invite with `email` off → `delivery: "simulated"`, no fetch.
ACCEPT: `pnpm test:db tests/db/module-jobs-channels.test.ts tests/db/jobs.test.ts tests/db/notifications-email-channel.test.ts tests/db/member-invite-actions.test.ts`; `pnpm test tests/unit/jobs-runner.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 12: MOD-T12 Migration — `app.module_catalog` + `app.module_enabled` + drift test (Sonnet, DB owner)
READ: BRIEF-COMMON.md (lessons 3–5); rulings; T1 catalog; `grep -rn "settings->'modules'" supabase/migrations` (batch-2 inlines, at least M13 `app.block_attendance_on_holiday`)
FILES: `supabase/migrations/20261028000084_module_enabled.sql` (new); `tests/db/module-enabled-sql.test.ts` (new); `docs/planning/coolskool/07-security-and-ai-governance.md` §4 (one row)
MIGRATION: `20261028000084_module_enabled.sql` (claimed at dispatch)
EXPORTS: `app.module_catalog(key text primary key, default_enabled boolean not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())` + `app.set_updated_at()` trigger; `revoke all … from public, anon, authenticated` (read only via definer helpers — `app.module_enabled` is the only reader); one `insert` row per `MODULES` key with its `default`. `app.module_enabled(p_institution_id uuid, p_key text) returns boolean` — `stable security definer set search_path = ''`; core keys → `true`; optional keys → `coalesce((settings->'modules'->>p_key)::boolean, (select default_enabled from app.module_catalog where key = p_key), false)` AND the `requires` keys (recursive call); unknown key → `raise exception 'code:internal' using detail = 'unknown module key'`; `revoke all … from public, anon, authenticated`. Defined **once**, here — later milestones add their key to `app.module_catalog` (`insert … on conflict (key) do update set default_enabled = excluded.default_enabled`) and never redefine this function. Re-create every inlining function found by the grep with the inline replaced by `app.module_enabled(...)`; body otherwise identical to its latest definition. No `db:types` (app schema).
TEST FIRST: for every key in `MODULE_KEYS` × settings `{}`, `{modules: all false}`, `allModulesOn()`, `{modules: {timetable: false, finance_plus: false, exams: false, ai_teacher: false}}` → SQL result equals TS `isModuleEnabled`; unknown key raises; holiday block still fires with `calendar` on and not with it off; TS catalog keys/defaults (`MODULES`) match `app.module_catalog` rows exactly (drift test).
ACCEPT: `pnpm db:reset`; `pnpm test:db tests/db/module-enabled-sql.test.ts` + the db test file of each re-created inlining function; `pnpm test:security tests/security/grants.test.ts` (update expectations if needed — say so); `pnpm lint`; `pnpm typecheck`

### Task 13: MOD-T13 Fixtures all-on, gate suite, `module` required (Sonnet)
READ: BRIEF-COMMON.md; rulings; `tests/helpers/roles.ts` (`createTestInstitution`); `tests/security/escalation.test.ts` (C-03 context, ~line 196); `tests/unit/action-names-unique.test.ts`
FILES: `tests/helpers/roles.ts` (insert `settings = {"modules": allModulesOn()}`); `tests/security/escalation.test.ts` (C-03 context `settings: { modules: allModulesOn() }` — one line, nothing else); `tests/security/module-gate.test.ts` (new); `src/lib/actions/define-action.ts`, `define-query.ts` (`module` required on `DefineActionOptions`/`DefineQueryOptions`; `GuardedCallOptions` stays optional); `tests/unit/action-names-unique.test.ts` (assert every action and query meta has `module` in `MODULE_KEYS`); test-local `defineAction`/`defineQuery` calls get `module: "core"`
MIGRATION: none
EXPORTS: none (tests + one type change). `pnpm typecheck` must pass: any definition still missing `module` is a T6–T9 miss — add it and name it in the report.
TEST FIRST: `module-gate.test.ts` (imports both manifests): for every registered action and query with an optional module, an owner context with that module stored false and input `{}` → `forbidden` + `MODULE_DISABLED_MESSAGE`; for every optional module with `requires`, turning off each required key forbids its names too; for every core-module name, a context with all optional modules off never returns `MODULE_DISABLED_MESSAGE`.
ACCEPT: `pnpm test:security tests/security/module-gate.test.ts tests/security/escalation.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts tests/unit/define-action.test.ts`; `pnpm test:db tests/db/core-actions.test.ts tests/db/tenant-context.test.ts tests/db/api-institutions-route.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 14: MOD-T14 Seed: demo tenant all modules on (Haiku, seed owner)
READ: BRIEF-COMMON.md; `scripts/seed/sections/core.ts`; `tests/db/seed-determinism.test.ts`
FILES: `scripts/seed/sections/core.ts` (settings = `InstitutionSettingsSchema.parse({ ...DEFAULT_INSTITUTION_SETTINGS, modules: allModulesOn() })`, import `../../../src/lib/modules/catalog.ts`); `tests/db/seed-modules.test.ts` (new)
MIGRATION: none
EXPORTS: none
TEST FIRST: demo tenant `settings.modules` equals `allModulesOn()` (every optional key true).
ACCEPT: `DEMO_RESET_ALLOWED=true pnpm demo:reset`; `pnpm test:db tests/db/seed-modules.test.ts tests/db/seed-determinism.test.ts`; `pnpm lint`; `pnpm typecheck`

---

Controller after T14: backlog index 0084 built; `07 §4` row present (T12); security review (Sonnet) on the T2, T4, T11, T12 diffs; full gate; `pnpm db:reset` + `pnpm seed` clean; commit/push; hosted push of 0084 owner-run (the hosted demo needs no reseed: every default-false module is unbuilt); `DONE MOD <sha>`. Debt to record: concurrent toggles can lose an update (read-modify-write of `settings`, same as `core.feature.set`); `GET /api/v1/actions` does not list `module`; no platform-admin override.
