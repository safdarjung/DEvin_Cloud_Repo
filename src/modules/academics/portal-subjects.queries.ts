import "server-only";
// Student/guardian read-only subjects + curriculum coverage for one section.
// Session client only; RLS (subject_assignments_select, curriculum_units_select,
// curriculum_unit_coverage_select) narrows to the caller's own section.
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { curriculumSectionUnits, type SectionUnitRow } from "./curriculum.queries";

export interface PortalSubject {
  id: string;
  name: string;
  units: SectionUnitRow[];
}

export async function listPortalSubjects(ctx: TenantContext, classSectionId: string): Promise<PortalSubject[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subject_assignments")
    .select("subject_id, subjects(name)")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", classSectionId);
  if (error) throw error;

  const byId = new Map<string, string>();
  for (const row of data ?? []) {
    byId.set(row.subject_id, (row.subjects as { name: string } | null)?.name ?? "Subject");
  }
  const subjects = await Promise.all(
    [...byId].map(async ([id, name]) => ({ id, name, units: await curriculumSectionUnits(ctx, { classSectionId, subjectId: id }) })),
  );
  return subjects.sort((a, b) => a.name.localeCompare(b.name));
}
