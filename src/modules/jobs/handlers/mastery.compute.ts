// M20-T11 — job handler `mastery.compute`. Plain node: relative `.ts` imports.
// Payload: none (built by `public.enqueue_mastery_compute`).
// M20-T12: the gap detector runs after every compute.
import { runMasteryGapDetector } from "../../mastery/detector.ts";
import type { JobHandler } from "../types.ts";

export const masteryCompute: JobHandler = async (job, { admin }) => {
  const institutionId = job.institution_id;
  if (!institutionId) {
    throw new Error("mastery.compute needs institution_id");
  }

  // DBT-153: one short statement per section; a retry recomputes (idempotent upserts).
  const { data: year, error: yearError } = await admin
    .from("academic_years")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .maybeSingle();
  if (yearError) throw new Error(yearError.message);

  if (year) {
    const { data: sections, error: sectionsError } = await admin
      .from("class_sections")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("academic_year_id", year.id);
    if (sectionsError) throw new Error(sectionsError.message);

    const runAt = new Date().toISOString();
    for (const section of sections ?? []) {
      const { error } = await admin.rpc("compute_mastery", {
        p_institution_id: institutionId,
        p_class_section_id: section.id,
        p_run_at: runAt,
      });
      if (error) throw new Error(error.message);
    }
    const { error } = await admin.rpc("compute_mastery_sweep", {
      p_institution_id: institutionId,
      p_run_at: runAt,
    });
    if (error) throw new Error(error.message);
  }

  await runMasteryGapDetector(admin, institutionId);
};
