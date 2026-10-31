// M02-T6 — read-only wrapper for ./queries.ts, exposed at
// /api/v1/query/jobs.<fn>. defineQuery adds Zod input validation + a
// permission gate; RLS stays the actual data filter.
import { defineQuery } from "@/lib/actions/define-query";
import { z } from "zod";
import { listAttentionJobs } from "./queries";

// permission: job.manage — jobs/page.tsx:39's only caller.
export const listAttentionJobsQuery = defineQuery({
  name: "jobs.listAttentionJobs",
  schema: z.object({}).strict(),
  permission: "job.manage",
  handler: (_input, ctx) => listAttentionJobs(ctx),
});
