import "server-only";
// M10-T4 — curriculum.* reads: coverageBySection (CurriculumCoverage fixture
// replacement, src/modules/fabric/types.ts / fabric/demo/learning.ts),
// sectionUnits (portal pacing, staff + own-section), lessonPlans. RLS
// (0072) is the real filter; institution_id/section filters below are
// defense in depth, same shape as every other queries.ts in this codebase.
// Mirrors src/modules/timetable/queries.ts (institution-local "today",
// section label convention) and src/modules/attendance/queries.ts
// (todayInInstitutionTimezone).
import { createClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import type { CurriculumCoverage } from "@/modules/fabric/types";

const LESSON_PLANS_LIMIT = 500;
const MS_PER_DAY = 86_400_000;

/** Institution-local calendar date (same approach as attendance/queries.ts's own helper). */
function todayInInstitutionTimezone(ctx: TenantContext): string {
  const locale = InstitutionSettingsSchema.shape.locale.safeParse(ctx.institution.settings.locale);
  const timezone = locale.success ? locale.data.timezone : "Asia/Kolkata";
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

interface CoverageRow extends CurriculumCoverage {
  gradeSortKey: number;
}

/**
 * Coverage pacing per (section, subject) for the is_current academic
 * year's sections (or exactly `classSectionId` when given). Fixed query
 * count regardless of row counts (rulings). Guardian/student can't read
 * `academic_years` (staff-only, 0002) so pacing can't be computed for
 * them — they use `curriculumSectionUnits` instead.
 */
export async function curriculumCoverageBySection(
  ctx: TenantContext,
  filter: { classSectionId?: string; subjectId?: string; teacherId?: string } = {},
): Promise<CurriculumCoverage[]> {
  if (ctx.membership.role === "guardian" || ctx.membership.role === "student") {
    throw new AppError("forbidden", "Coverage pacing is a staff-only view.");
  }

  const supabase = await createClient();

  const { data: year, error: yearError } = await supabase
    .from("academic_years")
    .select("id, starts_on, ends_on")
    .eq("institution_id", ctx.institution.id)
    .eq("is_current", true)
    .maybeSingle();
  if (yearError) throw yearError;
  if (!year) return [];

  let sectionsQuery = supabase
    .from("class_sections")
    .select("id, name, grade_id, grades(code, sort_key)")
    .eq("institution_id", ctx.institution.id)
    .eq("academic_year_id", year.id);
  if (filter.classSectionId) sectionsQuery = sectionsQuery.eq("id", filter.classSectionId);
  const { data: sectionRows, error: sectionsError } = await sectionsQuery;
  if (sectionsError) throw sectionsError;
  const sections = sectionRows ?? [];
  if (sections.length === 0) return [];
  const sectionIds = sections.map((s) => s.id);

  let assignmentsQuery = supabase
    .from("subject_assignments")
    .select("class_section_id, subject_id, subjects(name)")
    .eq("institution_id", ctx.institution.id)
    .in("class_section_id", sectionIds);
  if (filter.subjectId) assignmentsQuery = assignmentsQuery.eq("subject_id", filter.subjectId);
  // Teacher dashboard: only the (section, subject) pairs this staff member teaches.
  if (filter.teacherId) assignmentsQuery = assignmentsQuery.eq("teacher_id", filter.teacherId);
  const { data: assignmentRows, error: assignmentsError } = await assignmentsQuery;
  if (assignmentsError) throw assignmentsError;

  // Distinct (section, subject) pairs — more than one teacher on a
  // subject_assignments row would otherwise duplicate the coverage row.
  const seenPairs = new Set<string>();
  const pairs: { classSectionId: string; subjectId: string; subjectName: string }[] = [];
  for (const row of assignmentRows ?? []) {
    const key = `${row.class_section_id}:${row.subject_id}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const subject = row.subjects as { name: string } | null;
    pairs.push({ classSectionId: row.class_section_id, subjectId: row.subject_id, subjectName: subject?.name ?? "" });
  }
  if (pairs.length === 0) return [];

  // Grouped in SQL: row selects stop at PostgREST's 1000-row cap.
  const [{ data: unitCounts, error: unitsError }, { data: coverageCounts, error: coverageError }] = await Promise.all([
    supabase.rpc("dash_curriculum_unit_counts", { p_institution_id: ctx.institution.id }),
    supabase.rpc("dash_curriculum_coverage_counts", { p_institution_id: ctx.institution.id }),
  ]);
  if (unitsError) throw unitsError;
  if (coverageError) throw coverageError;
  const plannedByGradeSubject = new Map((unitCounts ?? []).map((r) => [`${r.grade_id}:${r.subject_id}`, Number(r.n)]));
  const completedBySectionSubject = new Map((coverageCounts ?? []).map((r) => [`${r.class_section_id}:${r.subject_id}`, Number(r.n)]));

  const today = todayInInstitutionTimezone(ctx);
  const totalDays = (new Date(year.ends_on).getTime() - new Date(year.starts_on).getTime()) / MS_PER_DAY;
  const elapsedDays = (new Date(today).getTime() - new Date(year.starts_on).getTime()) / MS_PER_DAY;
  const elapsed = totalDays > 0 ? clamp01(elapsedDays / totalDays) : 0;

  const sectionById = new Map(sections.map((s) => [s.id, s]));

  const rows: CoverageRow[] = pairs.map((pair) => {
    const section = sectionById.get(pair.classSectionId)!;
    const grade = section.grades as { code: string; sort_key: number } | null;
    const plannedUnits = plannedByGradeSubject.get(`${section.grade_id}:${pair.subjectId}`) ?? 0;
    const completedUnits = completedBySectionSubject.get(`${pair.classSectionId}:${pair.subjectId}`) ?? 0;
    return {
      subject: pair.subjectName,
      section_label: `${grade?.code ?? "?"}-${section.name}`,
      planned_units: plannedUnits,
      completed_units: completedUnits,
      on_track: completedUnits >= Math.floor(plannedUnits * elapsed),
      gradeSortKey: grade?.sort_key ?? 0,
    };
  });

  return rows
    .sort(
      (a, b) =>
        a.gradeSortKey - b.gradeSortKey ||
        a.section_label.localeCompare(b.section_label) ||
        a.subject.localeCompare(b.subject),
    )
    .map((row) => ({
      subject: row.subject,
      section_label: row.section_label,
      planned_units: row.planned_units,
      completed_units: row.completed_units,
      on_track: row.on_track,
    }));
}

export interface SectionUnitRow {
  id: string;
  title: string;
  sequence: number;
  coveredOn: string | null;
}

/** A section's units for one subject, with coverage dates — the debt row's portal replacement for coverageBySection (guardian/student). RLS narrows class_sections/coverage to own section; another family's section reads as []. */
export async function curriculumSectionUnits(
  ctx: TenantContext,
  params: { classSectionId: string; subjectId: string },
): Promise<SectionUnitRow[]> {
  const supabase = await createClient();

  const { data: section, error: sectionError } = await supabase
    .from("class_sections")
    .select("grade_id")
    .eq("institution_id", ctx.institution.id)
    .eq("id", params.classSectionId)
    .maybeSingle();
  if (sectionError) throw sectionError;
  if (!section) return [];

  const { data: unitRows, error: unitsError } = await supabase
    .from("curriculum_units")
    .select("id, title, sequence")
    .eq("institution_id", ctx.institution.id)
    .eq("grade_id", section.grade_id)
    .eq("subject_id", params.subjectId)
    .order("sequence");
  if (unitsError) throw unitsError;
  const units = unitRows ?? [];
  if (units.length === 0) return [];

  const { data: coverageRows, error: coverageError } = await supabase
    .from("curriculum_unit_coverage")
    .select("curriculum_unit_id, covered_on")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", params.classSectionId)
    .in(
      "curriculum_unit_id",
      units.map((u) => u.id),
    );
  if (coverageError) throw coverageError;
  const coveredOnByUnit = new Map((coverageRows ?? []).map((row) => [row.curriculum_unit_id, row.covered_on]));

  return units.map((unit) => ({
    id: unit.id,
    title: unit.title,
    sequence: unit.sequence,
    coveredOn: coveredOnByUnit.get(unit.id) ?? null,
  }));
}

export interface LessonPlanRow {
  id: string;
  classSectionId: string;
  subjectId: string;
  curriculumUnitId: string | null;
  plannedOn: string;
  title: string;
  objectives: string;
  resources: string | null;
  createdBy: string;
}

/** A section's lesson plans, optionally by subject/date range. RLS (owner/principal/admin + teaching scope) narrows out-of-scope roles to []. */
export async function curriculumLessonPlans(
  ctx: TenantContext,
  params: { classSectionId: string; subjectId?: string; from?: string; to?: string },
): Promise<LessonPlanRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("lesson_plans")
    .select("id, class_section_id, subject_id, curriculum_unit_id, planned_on, title, objectives, resources, created_by")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", params.classSectionId)
    .order("planned_on")
    .limit(LESSON_PLANS_LIMIT);
  if (params.subjectId) query = query.eq("subject_id", params.subjectId);
  if (params.from) query = query.gte("planned_on", params.from);
  if (params.to) query = query.lte("planned_on", params.to);
  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    classSectionId: row.class_section_id,
    subjectId: row.subject_id,
    curriculumUnitId: row.curriculum_unit_id,
    plannedOn: row.planned_on,
    title: row.title,
    objectives: row.objectives,
    resources: row.resources,
    createdBy: row.created_by,
  }));
}
