# M02-T4/T5/T6 report — attendance/admissions/core, exams/finance, notifications/jobs/ai/website query defs

## Files changed
- `src/modules/attendance/query-defs.ts` (new, T4)
- `src/modules/admissions/query-defs.ts` (new, T4)
- `src/modules/core/query-defs.ts` (new, T4)
- `src/modules/exams/query-defs.ts` (new, T5)
- `src/modules/finance/query-defs.ts` (new, T5)
- `src/modules/notifications/query-defs.ts` (new, T6)
- `src/modules/jobs/query-defs.ts` (new, T6)
- `src/modules/ai/query-defs.ts` (new, T6)
- `src/modules/website/query-defs.ts` (new, T6)
- `src/app/api/v1/query/all-queries.ts` (edit — 9 added import lines, one per module above)

No edit to `tests/unit/action-names-unique.test.ts` — the T3-authored completeness test is the one this task proves RED→GREEN against; it needed no changes itself.

## TDD — RED/GREEN per task

**T4** (attendance + admissions + core): wrote the 3 query-defs files, ran the test before touching `all-queries.ts` →
`pnpm test tests/unit/action-names-unique.test.ts` → 3 passed / 1 failed (`every defineQuery name is registered after importing the query manifest`: `Expected` set missing the 15 new T4 names). Added the 3 import lines → re-ran → 4 passed.

**T5** (exams + finance): wrote both query-defs files, ran before editing `all-queries.ts` → 3 passed / 1 failed (same assertion, now missing the 16 new T5 names on top of T4's). Added the 2 import lines → re-ran → 4 passed.

**T6** (notifications + jobs + ai + website): wrote all 4 query-defs files, ran before editing `all-queries.ts` → 3 passed / 1 failed (same assertion, missing T6's 11 new names). Added the 4 import lines → re-ran → 4 passed.

Final: `pnpm test tests/unit/action-names-unique.test.ts` → 4 passed (4).

## Permission table

| Query name | Permission | Why (file:line or default) |
|---|---|---|
| `attendance.getTodaySectionsForTeacher` | `attendance.read` | `attendance/page.tsx:17` (attendance.read) and `today/page.tsx:57` (attendance.mark — subset of attendance.read's holders) both reach it. |
| `attendance.getSession` | `attendance.mark` | `attendance/[sectionId]/page.tsx:20` and `today/page.tsx:57` both gate attendance.mark. |
| `attendance.getStudentAttendanceSummary` | `student.read` | 3 call sites: `portal/page.tsx:75` / `portal/attendance/page.tsx:19` gate `attendance.read`, but `students/[studentId]/page.tsx:15` (via `StudentProfile`'s unconditional `StudentAttendanceSummary`) gates only `student.read`, reachable by admissions/accountant who lack `attendance.read`. `student.read` is held by every role (07 §2.2) and is the real floor on all 3. |
| `attendance.attendanceTodaySummary` | `attendance.read` | Module default — no direct page caller (composed internally by `core.getDashboardData`). |
| `attendance.sectionsBelowThreshold` | `attendance.read` | Same as above. |
| `attendance.getSectionAttendancePatterns` | `attendance.read` | 2 sites: `attendance/[sectionId]/page.tsx:20` (attendance.mark) and the teacher AI agent (`/api/ai/agent/teacher/route.ts:172` gates `ai.generate` but then hard-restricts in code to `ctx.membership.role === "teacher"` — never gated the read on `ai.generate` itself per controller ruling). Both actual caller sets (owner/principal/admin/teacher) hold attendance.read. |
| `admissions.listEnquiriesByStage` | `admissions.enquiry.read` | `admissions/page.tsx:16`; dashboard's `canEnquiries` tile uses the same key. |
| `admissions.getEnquiry` | `admissions.enquiry.read` | `enquiries/[id]/page.tsx:15`; `/api/ai/enquiry-reply/route.ts:112` also requires this (plus ai.generate). |
| `admissions.listApplications` | `admissions.enquiry.read` | `applications/page.tsx:24`. |
| `admissions.getApplication` | `admissions.enquiry.read` | `applications/[id]/page.tsx:15`. |
| `admissions.listApplicationDecisions` | `admissions.enquiry.read` | Same page as getApplication. |
| `admissions.listSectionsForGrade` | `admissions.enquiry.read` | Same page. |
| `admissions.getAdmissionsFunnelCounts` | `admissions.enquiry.read` | Module default — no direct caller (composed internally by `core.getDashboardData`). |
| `core.getDashboardData` | `dashboard.view` | `dashboard/page.tsx:124`; module default. |
| `exams.listTermOptions` | `exam.manage` | `exams/new/page.tsx:16`'s only caller. |
| `exams.listSectionOptions` | `exam.manage` | `exams/[examId]/page.tsx:27`'s only caller. |
| `exams.listSubjectOptions` | `exam.manage` | Same page/caller. |
| `exams.listExams` | `exam.manage` | `exams/page.tsx:20` floor is `exam.result.read`, but the fn is only actually invoked when `canManage`/exam.manage is true; dashboard reaches it only for exam_controller (who also holds exam.manage). |
| `exams.getExamWithPapers` | `exam.result.read` | `exams/[examId]/page.tsx:27` (exam.manage) and `.../results/page.tsx:26` (exam.result.read); exam.manage's holders are a subset of exam.result.read's. |
| `exams.getPaperMarks` | `exam.marks.enter` | `exams/[examId]/papers/[paperId]/page.tsx:15`'s only caller. |
| `exams.getMyPapers` | `exam.marks.enter` | `exams/page.tsx:23` (canEnter) and `today/page.tsx:62` (canEnterMarks), both exam.marks.enter. |
| `exams.getCurrentResult` | `exam.result.read` | `exams/.../results/[studentId]/page.tsx:24` and `ReportCard.tsx` (via `portal/results/page.tsx:19`), both exam.result.read. |
| `exams.listResultsForExam` | `exam.result.read` | `exams/[examId]/results/page.tsx:26`'s only caller. |
| `exams.listResultsForStudent` | `exam.result.read` | `portal/results/page.tsx:19` and `portal/page.tsx:77`. |
| `exams.getResultHistory` | `exam.result.read` | `exams/.../results/[studentId]/page.tsx:24` (exam.result.read) and `exams/rechecks/[requestId]/page.tsx:24` (exam.recheck.review, whose holders are a subset of exam.result.read's). |
| `exams.listRechecksForResult` | `exam.result.read` | `ReportCard.tsx`'s only caller path. |
| `exams.listRecheckQueue` | `exam.recheck.review` | `exams/rechecks/page.tsx:18` and dashboard's `canRechecks`. |
| `exams.getRecheck` | `exam.recheck.review` | `exams/rechecks/[requestId]/page.tsx:24`'s only caller. |
| `exams.getResultRemark` | `exam.result.read` | `exams/.../results/[studentId]/page.tsx:24` and `ReportCard.tsx`, both exam.result.read. |
| `exams.examGradeDistribution` | `exam.result.read` | Module default — no direct caller (composed internally by `core.getDashboardData`). |
| `finance.listAcademicYears` | `student.read` | 4 call sites across 3 gates (finance.structure.manage, an attendance.read-conditioned call inside an attendance.mark page, finance.read inside `currentTermCollections`). The module's own comment says "any authenticated member may read these, not finance-scoped" — `student.read` is the only key every actual caller (incl. `teacher`, from the attendance page) holds. |
| `finance.listGradeOptions` | `finance.read` | `finance/structures/page.tsx` (finance.structure.manage) and `finance/invoices/page.tsx` (finance.read); finance.structure.manage's holders (owner/principal/admin/accountant) are a subset of finance.read's. |
| `finance.listTermOptions` | `finance.read` | `finance/invoices/page.tsx:23` (only called when finance.invoice.generate true) and `finance/defaulters/page.tsx:27` (finance.structure.manage); both subsets of finance.read's holders. |
| `finance.listFeeStructures` | `student.read` | `finance/structures` pages gate finance.structure.manage, but `admissions/applications/[id]/page.tsx:28` gates admissions.enquiry.read; no finance/admissions key covers both, so student.read. |
| `finance.getFeeStructure` | `finance.structure.manage` | `finance/structures/[id]/page.tsx:17`'s only caller. |
| `finance.listInvoices` | `finance.read` | `finance/invoices/page.tsx:18`'s only caller. |
| `finance.listInvoicesForStudent` | `student.read` | `students/[studentId]/page.tsx:22` calls this unconditionally behind only `student.read` (page excludes student/guardian via notFound(), but admits teacher/admissions/exam_controller who lack finance.read); student.read is the real floor across all call sites incl. the finance.read-gated portal pages. |
| `finance.getInvoice` | `finance.read` | `finance/invoices/[id]/page.tsx:19`'s only caller. |
| `finance.getReceipt` | `finance.read` | 3 sites (`receipts/[id]/page.tsx`, `receipts/[id]/print/page.tsx`, `portal/fees/receipts/[id]/page.tsx`), all finance.read. |
| `finance.listReceiptsForStudent` | `finance.read` | `portal/fees/page.tsx:22`'s only caller. |
| `finance.listLedgerEntries` | `finance.structure.manage` | `finance/ledger/page.tsx:39`'s only caller. |
| `finance.listDefaulters` | `finance.structure.manage` | `finance/defaulters/page.tsx:25` and dashboard's `(isLeader \|\| accountant)` condition (owner/principal/admin/accountant) — both equal finance.structure.manage's holder set exactly. |
| `finance.termCollectionSummary` | `finance.read` | Module default; its only caller (`currentTermCollections` inside `core.getDashboardData`) is itself gated finance.read before calling it. |
| `notifications.listMyNotifications` | `notification.read` | `notifications/page.tsx:17`, `portal/notifications/page.tsx:22`, and the conditioned calls in `today/page.tsx` / `portal/page.tsx`. |
| `notifications.unreadCount` | `notification.read` | Module default — no caller anywhere in `src/app`/`src/modules` today. |
| `notifications.listDeliveryLog` | `notification.log.read` | `notifications/log/page.tsx:15` and core's `getDashboardData` (`canReadActivity`); the fn itself also enforces this internally. |
| `jobs.listAttentionJobs` | `job.manage` | `jobs/page.tsx:39`'s only caller. |
| `ai.usageSummary` | `ai.usage.read` | `ai/usage/page.tsx:21`'s only caller. |
| `website.listPages` | `website.edit` | `website/page.tsx:13`'s only caller. |
| `website.getPageWithVersions` | `website.edit` | `website/pages/[pageId]/page.tsx:18` and `.../versions/[versionId]/page.tsx:17`. |
| `website.getVersion` | `website.edit` | Same 2 pages. |
| `website.listNotices` | `website.edit` | `website/notices/page.tsx:13`'s only caller. |
| `website.listEvents` | `website.edit` | `website/events/page.tsx:13`'s only caller. |
| `website.getWebsite` | `website.edit` | `website/page.tsx:13`'s only caller. |

## Skipped functions

| Function | Reason |
|---|---|
| `getAttendanceSettings` (attendance) | Synchronous, no I/O — reads already-loaded `ctx.institution.settings`. |
| `computeAttendancePercentage`, `buildAnonymizedAttendancePatterns` (attendance) | Pure helpers, no I/O, not `(ctx, …)` reads. |
| `enquiryStagesFor` (admissions) | Synchronous, no I/O. |
| `roundPercent`, `formatINR`, `currentTermCollections` (core) | Sync pure helpers / not exported (`currentTermCollections` is module-local). |
| `paymentModesFor`, `moneyToPaise`, `paiseToMoney` (finance) | Synchronous, no I/O, pure helpers. |
| `getPublicSite`, `getPublicPage`, `listPublicNotices`, `listPublicEvents` (website) | Named explicitly in the brief as skipped — public anon path, not the tenant query route. |
| `src/modules/ai/student-study.queries.ts` (all 3 fns: `listStudyItems`, `listStudyFolders`, `getStudyItem`) | Out of scope — this task's brief names only `ai/queries.ts` in READ and allows one `ai/query-defs.ts` file (≤40 lines); the notebook reads are a separate file the brief doesn't cover. Flagging for a future task if these need exposing. |

## Tests run
- `pnpm test tests/unit/action-names-unique.test.ts` — RED→GREEN at each of T4/T5/T6 (see TDD section); final run → 4 passed (4).
- `pnpm lint` → clean, no output.
- `pnpm typecheck` → `next typegen && tsc --noEmit` → "Types generated successfully", no errors.

## Tests not run and why
- `pnpm test` (full unit suite), `pnpm test:db`, `pnpm test:security`, `pnpm test:e2e` — out of scope per packet (unit only, no DB; lead runs full suite at checkpoints).

## Limitations / honesty label
- No UI/HTTP dispatcher route change in this task (query-defs + manifest only, same as T3). No honesty-badge surface touched.
- `notifications.unreadCount` and the no-caller fns (`admissions.getAdmissionsFunnelCounts`, `attendance.attendanceTodaySummary`, `attendance.sectionsBelowThreshold`, `exams.examGradeDistribution`) are wired per the brief's literal "every exported async ctx fn" rule even though no current page calls them directly — they'll be reachable at their `/api/v1/query/<name>` path once the HTTP dispatcher lands, gated by the module default permission documented above.

## Security / integration risks
- `attendance.getStudentAttendanceSummary`, `finance.listAcademicYears`, `finance.listFeeStructures`, `finance.listInvoicesForStudent` all land on `student.read` (the universal floor) rather than a tighter finance/attendance key, because their real call sites include a page gated more loosely than the data actually warrants (e.g. `students/[studentId]/page.tsx` gates only `student.read` but unconditionally renders finance/attendance widgets to any staff role reaching it, including `teacher`/`admissions`/`accountant`/`exam_controller`). This mirrors an existing gap in those pages' own gating, not something introduced here — flagging per controller's ruling (never gate a data read on a key some actual caller role doesn't hold) rather than tightening the existing pages myself (out of this packet's file scope).
- `finance.listDefaulters`/`finance.listLedgerEntries` use `finance.structure.manage`, a tighter key than the module default `finance.read` — confirmed exact match against both real call sites (defaulters page + dashboard condition; ledger page only).
- RLS remains the real data filter in every handler (unchanged — handlers only forward to the existing `queries.ts` functions, no new SQL).

## Follow-ups
- `src/modules/ai/student-study.queries.ts`'s 3 reads are not yet exposed via `/api/v1/query` — a future task should cover them if the student notebook needs this route.
- No new `12-decision-log.md` §Debt entries added beyond the notes above (not asked).

## New dependencies (justification)
- none

## Assumptions made
- Reused `uuid`/`isoDate` from `src/lib/schemas/common.ts` (same as T3) rather than the brief's literal `z.uuid()`/`z.iso.date()` snippets.
- `finance.listLedgerEntries`'s schema adds optional `page`/`pageSize` (both already optional params on the underlying fn) beyond the brief's literal `{ termId }` note, which was specifically about `listDefaulters`/`termCollectionSummary`.
- Compacted `website/query-defs.ts` and `ai/query-defs.ts`/`jobs/query-defs.ts` to single-line `defineQuery` calls where the schema has no fields, to fit the brief's "≤ 40 lines" cap per file for T6.
