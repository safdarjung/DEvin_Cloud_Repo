// M20-T8 — mastery.heatmapBySection / mastery.gapsForStudent reads: the
// MasteryCell fixture (masteryCells(), src/modules/fabric/demo/learning.ts)
// replacement + the gap list a guardian/student sees. Mirrors
// src/modules/timetable/queries.ts's shape; mastery_heatmap/mastery_
// student_stats (0093 part 2) are invoker functions — caller's own
// mastery_snapshots RLS narrows every row, so names are fetched in plain
// (also-RLS'd) queries, never a definer bypass.
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { percentageFromCounts, getAttendanceSettings, todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import type { InterventionPlan, MasteryCell, StudentSuccessRow } from "@/modules/fabric/types";
import {
  classifyStudent,
  GAP_THRESHOLD,
  gapsFrom,
  MIN_CONFIDENCE,
  masteryPct,
  trendFrom,
  type MasteryGap,
  type MasteryStats,
  type UnitScore,
} from "./rules";

const HEATMAP_PAGE_SIZE = 1000; // PostgREST max rows per request (rulings "SQL read functions")

interface HeatmapRpcRow {
  class_section_id: string;
  subject_id: string;
  curriculum_unit_id: string;
  mean_score: number;
  students: number;
  below: number;
}

/** The current year's `mastery_heatmap` rows, paged (rulings), or `[]` if there's no current year. */
async function fetchHeatmapRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  academicYearId: string,
  filter: { classSectionId?: string; subjectId?: string },
): Promise<HeatmapRpcRow[]> {
  const rows: HeatmapRpcRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .rpc("mastery_heatmap", {
        p_academic_year_id: academicYearId,
        // Generated Args type is non-nullable `string` (pg_proc exposes no
        // param nullability); the SQL function itself treats a null filter
        // as "all" (rulings), so the cast is runtime-accurate.
        p_class_section_id: (filter.classSectionId ?? null) as unknown as string,
        p_subject_id: (filter.subjectId ?? null) as unknown as string,
        p_gap_threshold: GAP_THRESHOLD,
        p_min_confidence: MIN_CONFIDENCE,
      })
      // Same order the SQL function already group-by/orders on — stable
      // paging, mirrors src/modules/insights/detectors/marks.ts.
      .order("class_section_id")
      .order("subject_id")
      .order("curriculum_unit_id")
      .range(from, from + HEATMAP_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as HeatmapRpcRow[];
    rows.push(...page);
    if (page.length < HEATMAP_PAGE_SIZE) break;
    from += HEATMAP_PAGE_SIZE;
  }
  return rows;
}

/**
 * The current year's mastery heatmap (one cell per section × subject ×
 * unit), optionally narrowed to one section and/or subject. `[]` when the
 * institution has no current academic year. Section/subject/unit names are
 * fetched separately (the RPC returns ids only) — RLS on those tables
 * narrows them the same way it narrows `mastery_snapshots`.
 */
export async function masteryHeatmap(
  ctx: TenantContext,
  filter: { classSectionId?: string; subjectId?: string } = {},
): Promise<MasteryCell[]> {
  const supabase = await createClient();
  const { data: year, error: yearError } = await supabase
    .from("academic_years")
    .select("id")
    .eq("institution_id", ctx.institution.id)
    .eq("is_current", true)
    .maybeSingle();
  if (yearError) throw yearError;
  if (!year) return [];

  const rows = await fetchHeatmapRows(supabase, year.id, filter);
  if (rows.length === 0) return [];

  const sectionIds = [...new Set(rows.map((r) => r.class_section_id))];
  const subjectIds = [...new Set(rows.map((r) => r.subject_id))];
  const unitIds = [...new Set(rows.map((r) => r.curriculum_unit_id))];

  const [{ data: sections, error: sectionsError }, { data: subjects, error: subjectsError }, { data: units, error: unitsError }] =
    await Promise.all([
      supabase.from("class_sections").select("id, name, grades(code, sort_key)").in("id", sectionIds),
      supabase.from("subjects").select("id, name").in("id", subjectIds),
      supabase.from("curriculum_units").select("id, title, sequence").in("id", unitIds),
    ]);
  if (sectionsError) throw sectionsError;
  if (subjectsError) throw subjectsError;
  if (unitsError) throw unitsError;

  const sectionById = new Map(
    (sections ?? []).map((s) => [s.id, { name: s.name, grade: s.grades as { code: string; sort_key: number } | null }]),
  );
  const subjectNameById = new Map((subjects ?? []).map((s) => [s.id, s.name]));
  const unitById = new Map((units ?? []).map((u) => [u.id, { title: u.title, sequence: u.sequence }]));

  return rows
    .map((row) => {
      const section = sectionById.get(row.class_section_id);
      const unit = unitById.get(row.curriculum_unit_id);
      const subjectName = subjectNameById.get(row.subject_id) ?? "";
      const cell: MasteryCell = {
        section_id: row.class_section_id,
        section_label: `${section?.grade?.code ?? "?"}-${section?.name ?? "?"}`,
        subject: subjectName,
        topic_id: row.curriculum_unit_id,
        topic: unit?.title ?? "",
        mastery_pct: masteryPct(row.mean_score),
        students_below_threshold: row.below,
      };
      return { cell, gradeSortKey: section?.grade?.sort_key ?? 0, sectionName: section?.name ?? "", subjectName, sequence: unit?.sequence ?? 0 };
    })
    .sort(
      (a, b) =>
        a.gradeSortKey - b.gradeSortKey ||
        a.sectionName.localeCompare(b.sectionName) ||
        a.subjectName.localeCompare(b.subjectName) ||
        a.sequence - b.sequence,
    )
    .map((r) => r.cell);
}

/**
 * One student's mastery gaps, weakest first (rules.gapsFrom) — the
 * StudentSuccessRow["gaps"] slice the InterventionPlan/heatmap share. Scoped
 * to the academic year of that student's most recently computed snapshot
 * (guardians/students can't read `academic_years`, rulings); `[]` when the
 * student has no snapshot rows this caller can see.
 */
export async function masteryGapsForStudent(ctx: TenantContext, studentId: string): Promise<MasteryGap[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mastery_snapshots")
    .select("academic_year_id, score, confidence, computed_at, subjects(name), curriculum_units(title, sequence)")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .order("computed_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const latestYearId = rows[0].academic_year_id;
  const units: UnitScore[] = rows
    .filter((row) => row.academic_year_id === latestYearId)
    .map((row) => {
      const subject = row.subjects as { name: string } | null;
      const unit = row.curriculum_units as { title: string; sequence: number } | null;
      return {
        subject: subject?.name ?? "",
        topic: unit?.title ?? "",
        sequence: unit?.sequence ?? 0,
        score: row.score,
        confidence: row.confidence,
      };
    });

  return gapsFrom(units);
}

// M20-T9 — mastery.studentSuccessRows / mastery.interventions: the
// StudentSuccessRow (studentSuccessRows()) and InterventionPlan
// (interventionPlans()) fixture replacements. Fixed query count per call
// (no per-student queries): enrolments+names, mastery_student_stats,
// snapshots (gaps), one term lookup + paged attendance_records, published
// exams + current results (trend), insight_actions plans — all scoped to
// the whole class section at once.

/** Institution-local calendar date for a timestamp (mirrors src/modules/facilities/queries.ts's dateInInstitutionTimezone). */
function dateInInstitutionTimezone(ctx: TenantContext, isoTimestamp: string): string {
  const locale = InstitutionSettingsSchema.shape.locale.safeParse(ctx.institution.settings.locale);
  const timeZone = locale.success ? locale.data.timezone : "Asia/Kolkata";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(isoTimestamp),
  );
}

interface StatsRpcRow {
  student_id: string;
  gap_units: number;
  confident_units: number;
  mean_score: number | null;
}

/** The year's term containing `today`, else the latest term that has started, else `null` (rulings "Gap detector" window, reused here for the attendance window). */
async function resolveCurrentTerm(
  supabase: Awaited<ReturnType<typeof createClient>>,
  institutionId: string,
  academicYearId: string,
  today: string,
): Promise<{ id: string; starts_on: string; ends_on: string } | null> {
  const { data, error } = await supabase
    .from("terms")
    .select("id, starts_on, ends_on")
    .eq("institution_id", institutionId)
    .eq("academic_year_id", academicYearId)
    .order("starts_on", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  return rows.find((t) => t.starts_on <= today && t.ends_on >= today) ?? rows.find((t) => t.starts_on <= today) ?? null;
}

interface PlanRow {
  student_id: string;
  intervention_status: string;
  updated_at: string;
  owner_staff_id: string | null;
  staff: { full_name: string } | null;
}

/**
 * One row per active student in `classSectionId` (StudentSuccessRow
 * fixture replacement) — current year, `[]` if none or the section/its
 * enrolments don't resolve. Risk/trend/flags are pure (rules.ts); every
 * data source here is the caller's own RLS (mastery_snapshots,
 * attendance_records, results, insight_actions).
 */
export async function masteryStudentSuccessRows(ctx: TenantContext, classSectionId: string): Promise<StudentSuccessRow[]> {
  const supabase = await createClient();

  const { data: year, error: yearError } = await supabase
    .from("academic_years")
    .select("id")
    .eq("institution_id", ctx.institution.id)
    .eq("is_current", true)
    .maybeSingle();
  if (yearError) throw yearError;
  if (!year) return [];

  const { data: section, error: sectionError } = await supabase
    .from("class_sections")
    .select("id, name, grades(code)")
    .eq("id", classSectionId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (sectionError) throw sectionError;
  if (!section) return [];
  const grade = section.grades as { code: string } | null;
  const sectionLabel = `${grade?.code ?? "?"}-${section.name}`;

  const { data: enrolments, error: enrolError } = await supabase
    .from("enrolments")
    .select("student_id, students(first_name, last_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", classSectionId)
    .eq("status", "active");
  if (enrolError) throw enrolError;
  const enrolmentRows = enrolments ?? [];
  if (enrolmentRows.length === 0) return [];
  const studentIds = enrolmentRows.map((e) => e.student_id);
  const nameById = new Map(
    enrolmentRows.map((e) => {
      const student = e.students as { first_name: string; last_name: string | null } | null;
      return [e.student_id, [student?.first_name, student?.last_name].filter(Boolean).join(" ")];
    }),
  );

  const { data: statsRows, error: statsError } = await supabase.rpc("mastery_student_stats", {
    p_academic_year_id: year.id,
    p_class_section_id: classSectionId,
    p_gap_threshold: GAP_THRESHOLD,
    p_min_confidence: MIN_CONFIDENCE,
  });
  if (statsError) throw statsError;
  const statsByStudent = new Map((statsRows as StatsRpcRow[] | null)?.map((r) => [r.student_id, r]) ?? []);

  const { data: snapshots, error: snapError } = await supabase
    .from("mastery_snapshots")
    .select("student_id, score, confidence, subjects(name), curriculum_units(title, sequence)")
    .eq("institution_id", ctx.institution.id)
    .eq("academic_year_id", year.id)
    .in("student_id", studentIds);
  if (snapError) throw snapError;
  const unitsByStudent = new Map<string, UnitScore[]>();
  for (const row of snapshots ?? []) {
    const subject = row.subjects as { name: string } | null;
    const unit = row.curriculum_units as { title: string; sequence: number } | null;
    const list = unitsByStudent.get(row.student_id) ?? [];
    list.push({ subject: subject?.name ?? "", topic: unit?.title ?? "", sequence: unit?.sequence ?? 0, score: row.score, confidence: row.confidence });
    unitsByStudent.set(row.student_id, list);
  }

  // Attendance — current term window, daily sessions only (period_id is
  // null, same scope as the insight attendance detector).
  const today = todayInInstitutionTimezone(ctx);
  const term = await resolveCurrentTerm(supabase, ctx.institution.id, year.id, today);
  const attendancePctByStudent = new Map<string, number>();
  const attendanceHasDataByStudent = new Set<string>();
  if (term) {
    const { data: counts, error: countsError } = await supabase.rpc("mastery_section_attendance", {
      p_class_section_id: classSectionId,
      p_from: term.starts_on,
      p_to: term.ends_on,
    });
    if (countsError) throw countsError;
    const settings = getAttendanceSettings(ctx);
    const countsByStudent = new Map<string, { status: string; n: number }[]>();
    for (const c of counts ?? []) {
      countsByStudent.set(c.student_id, [...(countsByStudent.get(c.student_id) ?? []), { status: c.status, n: Number(c.n) }]);
    }
    for (const studentId of studentIds) {
      const { percentage, totalInDenominator } = percentageFromCounts(countsByStudent.get(studentId) ?? [], settings.statuses);
      attendancePctByStudent.set(studentId, percentage);
      if (totalInDenominator > 0) attendanceHasDataByStudent.add(studentId);
    }
  }

  // Trend — current results of the year's published exams, in published order.
  const { data: exams, error: examsError } = await supabase
    .from("exams")
    .select("id, published_at")
    .eq("institution_id", ctx.institution.id)
    .eq("academic_year_id", year.id)
    .eq("status", "published")
    .order("published_at", { ascending: true });
  if (examsError) throw examsError;
  const examOrder = new Map((exams ?? []).map((e, i) => [e.id, i]));
  const trendByStudent = new Map<string, ReturnType<typeof trendFrom>>();
  if (examOrder.size > 0) {
    const { data: results, error: resultsError } = await supabase
      .from("results")
      .select("student_id, exam_id, percentage")
      .eq("institution_id", ctx.institution.id)
      .in("student_id", studentIds)
      .in("exam_id", [...examOrder.keys()])
      .is("superseded_by", null);
    if (resultsError) throw resultsError;
    const byStudent = new Map<string, { order: number; pct: number }[]>();
    for (const r of results ?? []) {
      const list = byStudent.get(r.student_id) ?? [];
      list.push({ order: examOrder.get(r.exam_id) ?? 0, pct: r.percentage });
      byStudent.set(r.student_id, list);
    }
    for (const [studentId, list] of byStudent) {
      list.sort((a, b) => a.order - b.order);
      trendByStudent.set(studentId, trendFrom(list.map((x) => x.pct)));
    }
  }

  // Plans — any status, for support_owner / last_contact / "Intervention active".
  const { data: planRows, error: planError } = await supabase
    .from("insight_actions")
    .select("student_id, intervention_status, updated_at, owner_staff_id, staff(full_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("kind", "intervention")
    .in("student_id", studentIds);
  if (planError) throw planError;
  const plansByStudent = new Map<string, PlanRow[]>();
  for (const row of (planRows as unknown as PlanRow[] | null) ?? []) {
    const list = plansByStudent.get(row.student_id) ?? [];
    list.push(row);
    plansByStudent.set(row.student_id, list);
  }

  const rows = studentIds.map((studentId) => {
    const stats = statsByStudent.get(studentId);
    const masteryStats: MasteryStats = {
      gapUnits: stats?.gap_units ?? 0,
      confidentUnits: stats?.confident_units ?? 0,
      meanScore: stats?.mean_score ?? null,
    };
    const trend = trendByStudent.get(studentId) ?? "flat";
    const hasData = attendanceHasDataByStudent.has(studentId);
    const attendancePct = attendancePctByStudent.get(studentId) ?? 0;
    const plans = plansByStudent.get(studentId) ?? [];
    const hasActivePlan = plans.some((p) => p.intervention_status === "active" || p.intervention_status === "review");

    const nonClosed = plans
      .filter((p) => p.intervention_status !== "closed")
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
    const supportOwner = nonClosed ? nonClosed.staff?.full_name ?? "Unassigned" : null;

    const nonProposed = plans
      .filter((p) => p.intervention_status !== "proposed")
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
    const lastContact = nonProposed ? dateInInstitutionTimezone(ctx, nonProposed.updated_at) : null;

    const { risk, flags } = classifyStudent(masteryStats, {
      trend,
      attendancePct: hasData ? attendancePct : null,
      hasActivePlan,
    });

    const row: StudentSuccessRow = {
      student_id: studentId,
      name: nameById.get(studentId) ?? "",
      section_label: sectionLabel,
      attendance_pct: attendancePct,
      mastery_pct: masteryStats.meanScore === null ? 0 : masteryPct(masteryStats.meanScore),
      trend,
      risk,
      support_owner: supportOwner,
      last_contact: lastContact,
      flags,
      gaps: gapsFrom(unitsByStudent.get(studentId) ?? []).slice(0, 5),
    };
    return { row, name: row.name };
  });

  const riskRank: Record<StudentSuccessRow["risk"], number> = { support: 0, watch: 1, none: 2 };
  return rows
    .sort((a, b) => riskRank[a.row.risk] - riskRank[b.row.risk] || a.name.localeCompare(b.name))
    .map((r) => r.row);
}

/**
 * RLS-scoped `insight_actions` of `kind = 'intervention'` (InterventionPlan
 * fixture replacement), optionally narrowed by student, class section
 * (active enrolment) or status. `restricted: true` always — plans are
 * wellbeing records (vision §11.11).
 */
export async function masteryInterventions(
  ctx: TenantContext,
  filter: { studentId?: string; classSectionId?: string; status?: InterventionPlan["status"] } = {},
): Promise<InterventionPlan[]> {
  const supabase = await createClient();

  let studentIds: string[] | undefined;
  if (filter.classSectionId) {
    const { data: enrolments, error } = await supabase
      .from("enrolments")
      .select("student_id")
      .eq("institution_id", ctx.institution.id)
      .eq("class_section_id", filter.classSectionId)
      .eq("status", "active");
    if (error) throw error;
    studentIds = (enrolments ?? []).map((e) => e.student_id);
    if (studentIds.length === 0) return [];
  }

  let query = supabase
    .from("insight_actions")
    .select("id, student_id, owner_staff_id, staff(full_name), goal, steps, intervention_status, review_date")
    .eq("institution_id", ctx.institution.id)
    .eq("kind", "intervention")
    .order("review_date", { ascending: true })
    .order("id", { ascending: true })
    .limit(200);
  if (filter.studentId) query = query.eq("student_id", filter.studentId);
  if (studentIds) query = query.in("student_id", studentIds);
  if (filter.status) query = query.eq("intervention_status", filter.status);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const staff = row.staff as { full_name: string } | null;
    return {
      id: row.id,
      student_id: row.student_id as string,
      owner: staff?.full_name ?? "Unassigned",
      goal: row.goal as string,
      steps: (row.steps ?? []) as InterventionPlan["steps"],
      status: row.intervention_status as InterventionPlan["status"],
      review_date: row.review_date as string,
      restricted: true,
    };
  });
}
