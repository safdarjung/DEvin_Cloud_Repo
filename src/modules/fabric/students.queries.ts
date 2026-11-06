// F-UI-04 — fabric/students lane reads: thin aggregation over owner-module
// queries, no new tables, no duplicated data. `studentSuccessRoster` merges
// mastery.studentSuccessRows (M20-T9) across every section the caller may
// see (class_sections RLS, 0020, narrows that already); `studentInterventionPlans`
// is a passthrough to mastery.interventions so the page never imports the
// mastery module directly.
import "server-only";
import type { TenantContext } from "@/lib/auth/types";
import { listSectionOptions, type SectionOption } from "@/modules/exams/queries";
import { masteryInterventions, masteryStudentSuccessRows } from "@/modules/mastery/queries";
import type { InterventionPlan, StudentSuccessRow } from "@/modules/fabric/types";

const RISK_RANK: Record<StudentSuccessRow["risk"], number> = { support: 0, watch: 1, none: 2 };

/** Every section the caller may see — the roster's section filter options. */
export async function studentSuccessSections(ctx: TenantContext): Promise<SectionOption[]> {
  return listSectionOptions(ctx);
}

/**
 * Roster rows across every section the caller may see, or just one when
 * `classSectionId` is given — StudentSuccessRow fixture replacement,
 * support-risk first then by name. `[]` if the institution has no sections
 * or none resolve any enrolled students under the caller's RLS.
 */
export async function studentSuccessRoster(
  ctx: TenantContext,
  filter: { classSectionId?: string } = {},
): Promise<StudentSuccessRow[]> {
  const sectionIds = filter.classSectionId ? [filter.classSectionId] : (await listSectionOptions(ctx)).map((s) => s.id);
  if (sectionIds.length === 0) return [];

  const rows = (await Promise.all(sectionIds.map((id) => masteryStudentSuccessRows(ctx, id)))).flat();
  return rows.sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk] || a.name.localeCompare(b.name));
}

/** Intervention plans visible to the caller — passthrough to mastery.interventions, restricted:true always. */
export async function studentInterventionPlans(
  ctx: TenantContext,
  filter: { studentId?: string; classSectionId?: string; status?: InterventionPlan["status"] } = {},
): Promise<InterventionPlan[]> {
  return masteryInterventions(ctx, filter);
}
