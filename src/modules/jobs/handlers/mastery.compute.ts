// M20-T11 — job handler `mastery.compute`. Plain node: relative `.ts` imports.
// Payload: none (built by `public.enqueue_mastery_compute`).
import type { JobHandler } from "../types.ts";

export const masteryCompute: JobHandler = async (job, { admin }) => {
  const institutionId = job.institution_id;
  if (!institutionId) {
    throw new Error("mastery.compute needs institution_id");
  }

  const { error } = await admin.rpc("compute_mastery", {
    p_institution_id: institutionId,
  });
  if (error) throw new Error(error.message);
};
