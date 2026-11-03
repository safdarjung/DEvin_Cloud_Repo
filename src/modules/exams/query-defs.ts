// M02-T5 — read-only wrappers for ./queries.ts, exposed at
// /api/v1/query/exams.<fn>. defineQuery adds Zod input validation + a
// permission gate; RLS stays the actual data filter. Handlers only adapt
// input -> the existing fn's positional args: no new logic, no new SQL.
import { defineQuery } from "@/lib/actions/define-query";
import { isoDate, uuid } from "@/lib/schemas/common";
import { z } from "zod";
import {
  examGradeDistribution,
  getCurrentResult,
  getExamWithPapers,
  getMyPapers,
  getPaperMarks,
  getRecheck,
  getResultHistory,
  getResultRemark,
  listExams,
  listRecheckQueue,
  listRechecksForResult,
  listResultsForExam,
  listResultsForStudent,
  listSectionOptions,
  listSubjectOptions,
  listTermOptions,
} from "./queries";
import { renderReportCardHtml } from "./report-card-html";
import { examSchedule, examScheduleConflicts } from "./schedule.queries";

// permission: exam.manage — exams/new/page.tsx:16's only caller.
export const listTermOptionsQuery = defineQuery({
  name: "exams.listTermOptions",
  schema: z.object({}).strict(),
  module: "exams",
  permission: "exam.manage",
  handler: (_input, ctx) => listTermOptions(ctx),
});

// permission: exam.manage — exams/[examId]/page.tsx:27, this fn's only
// caller (paired with listSubjectOptions there).
export const listSectionOptionsQuery = defineQuery({
  name: "exams.listSectionOptions",
  schema: z.object({}).strict(),
  module: "exams",
  permission: "exam.manage",
  handler: (_input, ctx) => listSectionOptions(ctx),
});

export const listSubjectOptionsQuery = defineQuery({
  name: "exams.listSubjectOptions",
  schema: z.object({}).strict(),
  module: "exams",
  permission: "exam.manage",
  handler: (_input, ctx) => listSubjectOptions(ctx),
});

// permission: exam.manage — exams/page.tsx:20 floor is exam.result.read,
// but this fn is only actually invoked when `canManage` (exam.manage) is
// true; dashboard/page.tsx:148 only reaches it for exam_controller (who
// holds exam.manage too). exam.manage is the floor every actual caller
// holds.
export const listExamsQuery = defineQuery({
  name: "exams.listExams",
  schema: z.object({}).strict(),
  module: "exams",
  permission: "exam.manage",
  handler: (_input, ctx) => listExams(ctx),
});

// permission: exam.result.read — 2 call sites: exams/[examId]/page.tsx:27
// (exam.manage) and exams/[examId]/results/page.tsx:26 (exam.result.read).
// exam.manage's holders (owner/principal/exam_controller) are already a
// subset of exam.result.read's holders, so exam.result.read is the floor
// every actual caller holds.
export const getExamWithPapersQuery = defineQuery({
  name: "exams.getExamWithPapers",
  schema: z.object({ examId: uuid }).strict(),
  module: "exams",
  permission: "exam.result.read",
  handler: (input, ctx) => getExamWithPapers(ctx, input.examId),
});

// permission: exam.marks.enter — exams/[examId]/papers/[paperId]/page.tsx:15's only caller.
export const getPaperMarksQuery = defineQuery({
  name: "exams.getPaperMarks",
  schema: z.object({ paperId: uuid }).strict(),
  module: "exams",
  permission: "exam.marks.enter",
  handler: (input, ctx) => getPaperMarks(ctx, input.paperId),
});

// permission: exam.marks.enter — exams/page.tsx:23 (canEnter) and
// today/page.tsx:62 (canEnterMarks) both gate on exam.marks.enter.
export const getMyPapersQuery = defineQuery({
  name: "exams.getMyPapers",
  schema: z.object({}).strict(),
  module: "exams",
  permission: "exam.marks.enter",
  handler: (_input, ctx) => getMyPapers(ctx),
});

// permission: exam.result.read — exams/[examId]/results/[studentId]/page.tsx:24
// and ReportCard.tsx (reused by portal/results/page.tsx:19, also
// exam.result.read) both gate on this.
export const getCurrentResultQuery = defineQuery({
  name: "exams.getCurrentResult",
  schema: z.object({ examId: uuid, studentId: uuid }).strict(),
  module: "exams",
  permission: "exam.result.read",
  handler: (input, ctx) => getCurrentResult(ctx, input.examId, input.studentId),
});

export const listResultsForExamQuery = defineQuery({
  name: "exams.listResultsForExam",
  schema: z.object({ examId: uuid }).strict(),
  module: "exams",
  permission: "exam.result.read",
  handler: (input, ctx) => listResultsForExam(ctx, input.examId),
});

// permission: exam.result.read — portal/results/page.tsx:19 and
// portal/page.tsx:77 both gate on this.
export const listResultsForStudentQuery = defineQuery({
  name: "exams.listResultsForStudent",
  schema: z.object({ studentId: uuid }).strict(),
  module: "exams",
  permission: "exam.result.read",
  handler: (input, ctx) => listResultsForStudent(ctx, input.studentId),
});

// permission: exam.result.read — exams/[examId]/results/[studentId]/page.tsx:24
// (exam.result.read) and exams/rechecks/[requestId]/page.tsx:24
// (exam.recheck.review, whose holders owner/principal/exam_controller are
// already a subset of exam.result.read's holders) both reach this fn.
export const getResultHistoryQuery = defineQuery({
  name: "exams.getResultHistory",
  schema: z.object({ examId: uuid, studentId: uuid }).strict(),
  module: "exams",
  permission: "exam.result.read",
  handler: (input, ctx) => getResultHistory(ctx, input.examId, input.studentId),
});

// permission: exam.result.read — ReportCard.tsx's only caller path
// (portal/results/page.tsx:19 / exams/.../results/[studentId]/page.tsx:24).
export const listRechecksForResultQuery = defineQuery({
  name: "exams.listRechecksForResult",
  schema: z.object({ resultId: uuid }).strict(),
  module: "exams",
  permission: "exam.result.read",
  handler: (input, ctx) => listRechecksForResult(ctx, input.resultId),
});

// permission: exam.recheck.review — exams/rechecks/page.tsx:18 and
// dashboard/page.tsx:147's canRechecks both gate on this.
export const listRecheckQueueQuery = defineQuery({
  name: "exams.listRecheckQueue",
  schema: z.object({ status: z.string().trim().min(1).max(50).optional() }).strict(),
  module: "exams",
  permission: "exam.recheck.review",
  handler: (input, ctx) => listRecheckQueue(ctx, input.status),
});

// permission: exam.recheck.review — exams/rechecks/[requestId]/page.tsx:24's only caller.
export const getRecheckQuery = defineQuery({
  name: "exams.getRecheck",
  schema: z.object({ requestId: uuid }).strict(),
  module: "exams",
  permission: "exam.recheck.review",
  handler: (input, ctx) => getRecheck(ctx, input.requestId),
});

// permission: exam.result.read — exams/[examId]/results/[studentId]/page.tsx:24
// and ReportCard.tsx both gate on this.
export const getResultRemarkQuery = defineQuery({
  name: "exams.getResultRemark",
  schema: z.object({ resultId: uuid }).strict(),
  module: "exams",
  permission: "exam.result.read",
  handler: (input, ctx) => getResultRemark(ctx, input.resultId),
});

// permission: exam.result.read — module default; no direct page caller
// (only composed internally by core's getDashboardData).
export const examGradeDistributionQuery = defineQuery({
  name: "exams.examGradeDistribution",
  schema: z.object({ examId: uuid.optional() }).strict(),
  module: "exams",
  permission: "exam.result.read",
  handler: (input, ctx) => examGradeDistribution(ctx, input.examId),
});

// permission: exam.result.read — AssessmentPlanItem replacement (rulings);
// every exam.result.read holder (owner/principal/admin/exam_controller/
// teacher/student/guardian) may call this, same floor as getCurrentResult;
// RLS (staff-only exam_papers_select) is what actually narrows a
// guardian/student's call to [].
export const examScheduleQuery = defineQuery({
  name: "exams.schedule",
  schema: z
    .object({
      examId: uuid.optional(),
      classSectionId: uuid.optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
    })
    .strict(),
  module: "exams",
  permission: "exam.result.read",
  handler: (input, ctx) => examSchedule(ctx, input),
});

// permission: exam.manage — rulings reuse this key for scheduleConflicts
// (owner/principal/exam_controller only; teacher holds exam.result.read
// but not exam.manage, so a teacher call is `forbidden` here).
export const examScheduleConflictsQuery = defineQuery({
  name: "exams.scheduleConflicts",
  schema: z.object({ examId: uuid }).strict(),
  module: "exams",
  permission: "exam.manage",
  handler: (input, ctx) => examScheduleConflicts(ctx, input.examId),
});

// permission: exam.result.read — same floor/RLS scope as getCurrentResult
// (rulings: Report card HTML). ?format=html (route.ts) renders this as the
// document itself; a plain POST/GET without that param gets the raw
// { html } string back in the JSON envelope.
export const reportCardHtmlQuery = defineQuery({
  name: "exams.reportCardHtml",
  schema: z.object({ examId: uuid, studentId: uuid }).strict(),
  module: "exams",
  permission: "exam.result.read",
  handler: async (input, ctx) => {
    const result = await getCurrentResult(ctx, input.examId, input.studentId);
    if (!result) return null;
    const remark = await getResultRemark(ctx, result.id);
    return { html: renderReportCardHtml({ institutionName: ctx.institution.name, result, remark }) };
  },
});
