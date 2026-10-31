// M02-T4 — read-only wrappers for ./queries.ts, exposed at
// /api/v1/query/admissions.<fn>. defineQuery adds Zod input validation + a
// permission gate; RLS stays the actual data filter. Handlers only adapt
// input -> the existing fn's positional args: no new logic, no new SQL.
// enquiryStagesFor is skipped — synchronous, no I/O (reads already-loaded
// ctx.institution.settings).
import { defineQuery } from "@/lib/actions/define-query";
import { uuid } from "@/lib/schemas/common";
import { z } from "zod";
import {
  getAdmissionsFunnelCounts,
  getApplication,
  getEnquiry,
  listApplicationDecisions,
  listApplications,
  listEnquiriesByStage,
  listSectionsForGrade,
} from "./queries";
import type { ApplicationStatus } from "./state";

const APPLICATION_STATUS = z.enum([
  "submitted",
  "under_review",
  "interaction_scheduled",
  "offered",
  "accepted",
  "rejected",
  "withdrawn",
  "enrolled",
]) satisfies z.ZodType<ApplicationStatus>;

// permission: admissions.enquiry.read — admissions/page.tsx:16 and the
// dashboard's canEnquiries-gated tile (dashboard/page.tsx:149) both gate on
// this; the module default (06 task-4 brief).
export const listEnquiriesByStageQuery = defineQuery({
  name: "admissions.listEnquiriesByStage",
  schema: z.object({}).strict(),
  permission: "admissions.enquiry.read",
  handler: (_input, ctx) => listEnquiriesByStage(ctx),
});

// permission: admissions.enquiry.read — enquiries/[id]/page.tsx:15 and
// /api/ai/enquiry-reply/route.ts:112 (also requires ai.generate, but
// admissions.enquiry.read is the data-read gate) both use this key.
export const getEnquiryQuery = defineQuery({
  name: "admissions.getEnquiry",
  schema: z.object({ enquiryId: uuid }).strict(),
  permission: "admissions.enquiry.read",
  handler: (input, ctx) => getEnquiry(ctx, input.enquiryId),
});

export const listApplicationsQuery = defineQuery({
  name: "admissions.listApplications",
  schema: z.object({ status: APPLICATION_STATUS.optional() }).strict(),
  permission: "admissions.enquiry.read",
  handler: (input, ctx) => listApplications(ctx, input.status),
});

export const getApplicationQuery = defineQuery({
  name: "admissions.getApplication",
  schema: z.object({ applicationId: uuid }).strict(),
  permission: "admissions.enquiry.read",
  handler: (input, ctx) => getApplication(ctx, input.applicationId),
});

export const listApplicationDecisionsQuery = defineQuery({
  name: "admissions.listApplicationDecisions",
  schema: z.object({ applicationId: uuid }).strict(),
  permission: "admissions.enquiry.read",
  handler: (input, ctx) => listApplicationDecisions(ctx, input.applicationId),
});

export const listSectionsForGradeQuery = defineQuery({
  name: "admissions.listSectionsForGrade",
  schema: z.object({ gradeId: uuid, academicYearId: uuid }).strict(),
  permission: "admissions.enquiry.read",
  handler: (input, ctx) => listSectionsForGrade(ctx, input.gradeId, input.academicYearId),
});

// permission: admissions.enquiry.read — module default; no direct page
// caller (only composed internally by core's getDashboardData).
export const getAdmissionsFunnelCountsQuery = defineQuery({
  name: "admissions.getAdmissionsFunnelCounts",
  schema: z.object({ academicYearId: uuid.optional() }).strict(),
  permission: "admissions.enquiry.read",
  handler: (input, ctx) => getAdmissionsFunnelCounts(ctx, input.academicYearId),
});
