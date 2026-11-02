import { insertBatch } from "../lib/batch.ts";
import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";

// M10-T5 (M10-tasks.md Task 5) — one lesson plan per curriculum unit for
// every current-year subject_assignments row (section x subject), plus a
// coverage fact row for units with sequence <= k (k in {1,2,3}, drawn from
// the PRNG per section+subject), except X-A Mathematics, which the demo
// contract (05 §8.1) pins at exactly units 1-2 covered, unit 3 planned but
// not covered (the live demo step marks it).

const PLAN_START = "2026-07-01"; // inside the seeded academic year (starts 2026-04-01).
const PLAN_DAY_STEP = 42;
const COVERAGE_DAY_STEP = 21;
const DEMO_K = 2; // X-A Mathematics override.

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function run(ctx: SeedContext): Promise<void> {
  const { data: sections, error: sectionsError } = await ctx.admin
    .from("class_sections")
    .select("id, grade_id, name")
    .eq("institution_id", ctx.institutionId)
    .eq("academic_year_id", ctx.academicYearId);
  if (sectionsError) throw new Error(`curriculum: class_sections query failed: ${sectionsError.message}`);

  const { data: grades, error: gradesError } = await ctx.admin
    .from("grades")
    .select("id, code")
    .eq("institution_id", ctx.institutionId);
  if (gradesError) throw new Error(`curriculum: grades query failed: ${gradesError.message}`);
  const gradeCodeById = new Map((grades ?? []).map((g) => [g.id, g.code]));

  const { data: subjects, error: subjectsError } = await ctx.admin
    .from("subjects")
    .select("id, code")
    .eq("institution_id", ctx.institutionId);
  if (subjectsError) throw new Error(`curriculum: subjects query failed: ${subjectsError.message}`);
  const subjectCodeById = new Map((subjects ?? []).map((s) => [s.id, s.code]));

  const { data: units, error: unitsError } = await ctx.admin
    .from("curriculum_units")
    .select("id, subject_id, grade_id, sequence, title")
    .eq("institution_id", ctx.institutionId)
    .order("sequence");
  if (unitsError) throw new Error(`curriculum: curriculum_units query failed: ${unitsError.message}`);
  const unitsBySubjectGrade = new Map<string, { id: string; sequence: number; title: string }[]>();
  for (const unit of units ?? []) {
    const key = `${unit.subject_id}:${unit.grade_id}`;
    const list = unitsBySubjectGrade.get(key) ?? [];
    list.push({ id: unit.id, sequence: unit.sequence, title: unit.title });
    unitsBySubjectGrade.set(key, list);
  }

  const sectionById = new Map((sections ?? []).map((s) => [s.id, s]));
  const sectionIds = (sections ?? []).map((s) => s.id);

  const { data: assignments, error: assignmentsError } = await ctx.admin
    .from("subject_assignments")
    .select("class_section_id, subject_id")
    .eq("institution_id", ctx.institutionId)
    .in("class_section_id", sectionIds)
    .order("class_section_id")
    .order("subject_id");
  if (assignmentsError) throw new Error(`curriculum: subject_assignments query failed: ${assignmentsError.message}`);

  const principalId = ctx.userIdByLogin["principal"]!;
  const xaMathTeacherId = ctx.userIdByLogin["teacher.x-a"]!;

  const lessonPlanRows: Record<string, unknown>[] = [];
  const coverageRows: Record<string, unknown>[] = [];

  for (const assignment of assignments ?? []) {
    const section = sectionById.get(assignment.class_section_id)!;
    const gradeCode = gradeCodeById.get(section.grade_id)!;
    const subjectCode = subjectCodeById.get(assignment.subject_id)!;
    const unitList = unitsBySubjectGrade.get(`${assignment.subject_id}:${section.grade_id}`) ?? [];
    const isXaMath = gradeCode === "X" && section.name === "A" && subjectCode === "MATH";
    const actorId = isXaMath ? xaMathTeacherId : principalId;

    // Always draw, even for the X-A Mathematics override, so every other
    // section+subject's draw stays at the same PRNG position regardless of
    // the override (05 §8: reseed determinism).
    const drawnK = 1 + Math.floor(ctx.rng() * 3);
    const k = isXaMath ? DEMO_K : drawnK;

    const sectionKey = `${gradeCode}-${section.name}`;
    const planIdByUnitId = new Map<string, string>();

    for (const unit of unitList) {
      const planId = uuidV5("curriculum", `lesson_plan:${sectionKey}:${subjectCode}:${unit.sequence}`);
      planIdByUnitId.set(unit.id, planId);
      lessonPlanRows.push({
        id: planId,
        institution_id: ctx.institutionId,
        class_section_id: section.id,
        subject_id: assignment.subject_id,
        curriculum_unit_id: unit.id,
        planned_on: addDays(PLAN_START, (unit.sequence - 1) * PLAN_DAY_STEP),
        title: unit.title,
        objectives: `Cover "${unit.title}"`,
        created_by: actorId,
      });
    }

    for (const unit of unitList) {
      if (unit.sequence > k) continue;
      coverageRows.push({
        id: uuidV5("curriculum", `coverage:${sectionKey}:${subjectCode}:${unit.sequence}`),
        institution_id: ctx.institutionId,
        class_section_id: section.id,
        subject_id: assignment.subject_id,
        curriculum_unit_id: unit.id,
        covered_on: addDays(PLAN_START, unit.sequence * COVERAGE_DAY_STEP),
        lesson_plan_id: planIdByUnitId.get(unit.id)!,
        marked_by: actorId,
      });
    }
  }

  await insertBatch(ctx.admin, "lesson_plans", lessonPlanRows);
  await insertBatch(ctx.admin, "curriculum_unit_coverage", coverageRows);
}
