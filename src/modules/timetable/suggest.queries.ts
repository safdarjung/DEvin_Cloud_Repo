import "server-only";
// M25-T8 — timetable.suggest: wraps the M25-T3 pure fill_v1 engine
// (./suggest.ts) with the DB reads it needs. Read-only (rulings
// "timetable.suggest is a query, never a write"): never touches
// timetable_slots. Mirrors actions.ts's assertVersionInInstitution for the
// not_found/invalid_state shape, and queries.ts's maxPeriodsPerWeek for the
// per-institution cap.
import { createClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { loadRules, maxPeriodsPerWeek } from "@/modules/timetable/queries";
import { suggestFill, SUGGEST_ENGINE_VERSION, type BlockedCell, type SuggestInput, type TimetableSuggestion } from "@/modules/timetable/suggest";
import { checkViolations, type CheckModel } from "@/modules/timetable/checks";
import type { TimetableRules } from "@/modules/timetable/rules";
import type { SuggestFillInput } from "@/modules/timetable/schemas";

export type SuggestClient = Awaited<ReturnType<typeof createClient>>;

// PostgREST defaults to a 1,000-row page (same bug class as
// finance.generate_term_invoices.ts / M19); a version with more than 1,000
// slots would otherwise be silently truncated, hiding real occupancy.
const PAGE_SIZE = 1000;

export async function loadVersion(
  supabase: SuggestClient,
  versionId: string,
  institutionId: string,
): Promise<{ status: string; academicYearId: string }> {
  const { data, error } = await supabase
    .from("timetable_versions")
    .select("status, academic_year_id")
    .eq("id", versionId)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("not_found", "Timetable version not found.");
  return { status: data.status as string, academicYearId: data.academic_year_id as string };
}

/** Non-break periods with their band: before or after the lunch break (a break named "lunch", else the last break; none -> no band). */
export async function loadPeriods(supabase: SuggestClient, institutionId: string): Promise<SuggestInput["periods"]> {
  const { data, error } = await supabase.from("periods").select("id, seq, name, is_break").eq("institution_id", institutionId);
  if (error) throw error;
  const rows = data ?? [];
  const breaks = rows.filter((p) => p.is_break).sort((a, b) => a.seq - b.seq);
  const lunch = breaks.find((p) => /lunch/i.test(p.name)) ?? breaks[breaks.length - 1];
  return rows
    .filter((p) => !p.is_break)
    .map((p) => ({ id: p.id, seq: p.seq, name: p.name, ...(lunch ? { band: p.seq < lunch.seq ? ("before_lunch" as const) : ("after_lunch" as const) } : {}) }));
}

export async function loadSections(
  supabase: SuggestClient,
  institutionId: string,
  academicYearId: string,
  classSectionIds: string[] | undefined,
): Promise<SuggestInput["sections"]> {
  let query = supabase
    .from("class_sections")
    .select("id, name, grades(code)")
    .eq("institution_id", institutionId)
    .eq("academic_year_id", academicYearId);
  if (classSectionIds && classSectionIds.length > 0) query = query.in("id", classSectionIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => {
    const grade = row.grades as { code: string } | null;
    return { id: row.id as string, label: `${grade?.code ?? "?"}-${row.name as string}` };
  });
}

async function loadAssignments(
  supabase: SuggestClient,
  institutionId: string,
  sectionIds: string[],
): Promise<SuggestInput["assignments"]> {
  if (sectionIds.length === 0) return [];
  const { data, error } = await supabase
    .from("subject_assignments")
    .select("class_section_id, subject_id, subjects(name), teacher_id, staff(full_name, status)")
    .eq("institution_id", institutionId)
    .in("class_section_id", sectionIds);
  if (error) throw error;
  return (data ?? [])
    .filter((row) => (row.staff as { status: string } | null)?.status === "active")
    .map((row) => ({
      classSectionId: row.class_section_id as string,
      subjectId: row.subject_id as string,
      subjectName: (row.subjects as { name: string } | null)?.name ?? "",
      teacherId: row.teacher_id as string,
      teacherName: (row.staff as { full_name: string } | null)?.full_name ?? "",
    }));
}

export async function loadRooms(supabase: SuggestClient, institutionId: string): Promise<SuggestInput["rooms"]> {
  const { data, error } = await supabase.from("rooms").select("id, name, kind").eq("institution_id", institutionId);
  if (error) throw error;
  return data ?? [];
}

/** Every slot of the version (all sections — occupancy needs the whole picture), paged in 1000s. */
export async function loadAllSlots(supabase: SuggestClient, institutionId: string, versionId: string): Promise<SuggestInput["slots"]> {
  const slots: SuggestInput["slots"] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("timetable_slots")
      .select("class_section_id, weekday, period_id, subject_id, teacher_id, room_id")
      .eq("institution_id", institutionId)
      .eq("version_id", versionId)
      .order("id") // stable order, or pages can skip/repeat rows
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    for (const row of page) {
      slots.push({
        classSectionId: row.class_section_id as string,
        weekday: row.weekday as number,
        periodId: row.period_id as string,
        subjectId: row.subject_id as string,
        teacherId: row.teacher_id as string,
        roomId: (row.room_id as string | null) ?? null,
      });
    }
    if (page.length < PAGE_SIZE) break;
  }
  return slots;
}

/** Subject and teacher names for the given ids (for violation messages). */
async function loadNames(supabase: SuggestClient, institutionId: string, slots: SuggestInput["slots"]) {
  const subjectIds = [...new Set(slots.map((s) => s.subjectId))];
  const teacherIds = [...new Set(slots.map((s) => s.teacherId))];
  const [subjects, staff] = await Promise.all([
    subjectIds.length ? supabase.from("subjects").select("id, name").eq("institution_id", institutionId).in("id", subjectIds) : null,
    teacherIds.length ? supabase.from("staff").select("id, full_name").eq("institution_id", institutionId).in("id", teacherIds) : null,
  ]);
  if (subjects?.error) throw subjects.error;
  if (staff?.error) throw staff.error;
  return {
    subjectNames: Object.fromEntries((subjects?.data ?? []).map((r) => [r.id, r.name])) as Record<string, string>,
    teacherNames: Object.fromEntries((staff?.data ?? []).map((r) => [r.id, r.full_name])) as Record<string, string>,
  };
}

/** Everything checkViolations needs for one version (any status the caller can read). */
export async function loadCheckModel(ctx: TenantContext, versionId: string): Promise<CheckModel & { status: string }> {
  const supabase = await createClient();
  const institutionId = ctx.institution.id;
  const version = await loadVersion(supabase, versionId, institutionId);
  const [periods, sections, rooms, slots, rules] = await Promise.all([
    loadPeriods(supabase, institutionId),
    loadSections(supabase, institutionId, version.academicYearId, undefined),
    loadRooms(supabase, institutionId),
    loadAllSlots(supabase, institutionId, versionId),
    loadRules(ctx),
  ]);
  const names = await loadNames(supabase, institutionId, slots);
  return {
    status: version.status,
    periods,
    slots,
    rooms,
    rules,
    sectionLabels: Object.fromEntries(sections.map((s) => [s.id, s.label])),
    ...names,
  };
}

/** Rule violations of a version — the checklist shown before publishing. Requires timetable.manage. */
export async function timetableViolations(ctx: TenantContext, versionId: string) {
  const model = await loadCheckModel(ctx, versionId);
  return checkViolations(model);
}

export interface SuggestImpact {
  sections: { id: string; label: string; emptyBefore: number; emptyAfter: number; violationsBefore: number; violationsAfter: number }[];
  teachers: { id: string; name: string; periodsBefore: number; periodsAfter: number; cap: number | null }[];
  clashes: 0;
}

/** Before/after of applying every suggestion: empty periods and rule violations per section, load per teacher. */
function impactOf(
  input: SuggestInput & { rules: TimetableRules },
  suggestions: TimetableSuggestion[],
  model: Omit<CheckModel, "slots">,
): SuggestImpact {
  const after = [...input.slots, ...suggestions.map((s) => ({ ...s.slot, roomId: s.slot.roomId ?? null }))];
  const before = checkViolations({ ...model, slots: input.slots });
  const afterV = checkViolations({ ...model, slots: after });
  const cells = 6 * input.periods.length;
  const filled = (slots: SuggestInput["slots"], id: string) => slots.filter((s) => s.classSectionId === id).length;
  const touchedSections = new Set(suggestions.map((s) => s.slot.classSectionId));
  const touchedTeachers = new Set(suggestions.map((s) => s.slot.teacherId));
  const load = (slots: SuggestInput["slots"], id: string) => slots.filter((s) => s.teacherId === id).length;
  const cap = input.rules.max_teacher_per_week.enabled ? input.rules.max_teacher_per_week.value : null;
  return {
    sections: input.sections
      .filter((s) => touchedSections.has(s.id))
      .map((s) => ({
        id: s.id,
        label: s.label,
        emptyBefore: cells - filled(input.slots, s.id),
        emptyAfter: cells - filled(after, s.id),
        violationsBefore: before.filter((v) => v.sectionId === s.id).length,
        violationsAfter: afterV.filter((v) => v.sectionId === s.id).length,
      })),
    teachers: [...touchedTeachers].sort().map((id) => ({
      id,
      name: input.assignments.find((a) => a.teacherId === id)?.teacherName ?? "",
      periodsBefore: load(input.slots, id),
      periodsAfter: load(after, id),
      cap,
    })),
    clashes: 0,
  };
}

export async function suggestTimetableFill(
  ctx: TenantContext,
  input: SuggestFillInput,
): Promise<{
  versionId: string;
  engineVersion: typeof SUGGEST_ENGINE_VERSION;
  suggestions: TimetableSuggestion[];
  unfilled: number;
  truncated: boolean;
  blocked: BlockedCell[];
  rules: TimetableRules;
  impact: SuggestImpact;
}> {
  const supabase = await createClient();
  const institutionId = ctx.institution.id;

  const version = await loadVersion(supabase, input.versionId, institutionId);
  if (version.status !== "draft") {
    throw new AppError("invalid_state", "Suggestions apply to draft versions only.");
  }

  const [periods, sections, rooms, rules] = await Promise.all([
    loadPeriods(supabase, institutionId),
    loadSections(supabase, institutionId, version.academicYearId, input.classSectionIds),
    loadRooms(supabase, institutionId),
    loadRules(ctx),
  ]);
  const [assignments, slots] = await Promise.all([
    loadAssignments(supabase, institutionId, sections.map((s) => s.id)),
    loadAllSlots(supabase, institutionId, input.versionId),
  ]);

  const engineInput = { periods, sections, assignments, slots, rooms, maxPeriodsWeek: maxPeriodsPerWeek(ctx), limit: input.limit, rules };
  const { suggestions, unfilled, truncated, blocked } = suggestFill(engineInput);
  const names = await loadNames(supabase, institutionId, [...slots, ...suggestions.map((s) => ({ ...s.slot, roomId: s.slot.roomId ?? null }))]);
  const impact = impactOf(engineInput, suggestions, {
    periods,
    rooms,
    rules,
    sectionLabels: Object.fromEntries(sections.map((s) => [s.id, s.label])),
    ...names,
  });

  return { versionId: input.versionId, engineVersion: SUGGEST_ENGINE_VERSION, suggestions, unfilled, truncated, blocked, rules, impact };
}
