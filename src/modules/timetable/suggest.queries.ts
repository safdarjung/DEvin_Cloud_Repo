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
import { maxPeriodsPerWeek } from "@/modules/timetable/queries";
import { suggestFill, SUGGEST_ENGINE_VERSION, type SuggestInput, type TimetableSuggestion } from "@/modules/timetable/suggest";
import type { SuggestFillInput } from "@/modules/timetable/schemas";

type SuggestClient = Awaited<ReturnType<typeof createClient>>;

// PostgREST defaults to a 1,000-row page (same bug class as
// finance.generate_term_invoices.ts / M19); a version with more than 1,000
// slots would otherwise be silently truncated, hiding real occupancy.
const PAGE_SIZE = 1000;

async function loadVersion(
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

async function loadPeriods(supabase: SuggestClient, institutionId: string): Promise<SuggestInput["periods"]> {
  const { data, error } = await supabase
    .from("periods")
    .select("id, seq, name")
    .eq("institution_id", institutionId)
    .eq("is_break", false);
  if (error) throw error;
  return data ?? [];
}

async function loadSections(
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

async function loadRooms(supabase: SuggestClient, institutionId: string): Promise<SuggestInput["rooms"]> {
  const { data, error } = await supabase.from("rooms").select("id, name").eq("institution_id", institutionId);
  if (error) throw error;
  return data ?? [];
}

/** Every slot of the version (all sections — occupancy needs the whole picture), paged in 1000s. */
async function loadAllSlots(supabase: SuggestClient, institutionId: string, versionId: string): Promise<SuggestInput["slots"]> {
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

export async function suggestTimetableFill(
  ctx: TenantContext,
  input: SuggestFillInput,
): Promise<{ versionId: string; engineVersion: 1; suggestions: TimetableSuggestion[]; unfilled: number; truncated: boolean }> {
  const supabase = await createClient();
  const institutionId = ctx.institution.id;

  const version = await loadVersion(supabase, input.versionId, institutionId);
  if (version.status !== "draft") {
    throw new AppError("invalid_state", "Suggestions apply to draft versions only.");
  }

  const [periods, sections, rooms] = await Promise.all([
    loadPeriods(supabase, institutionId),
    loadSections(supabase, institutionId, version.academicYearId, input.classSectionIds),
    loadRooms(supabase, institutionId),
  ]);
  const [assignments, slots] = await Promise.all([
    loadAssignments(supabase, institutionId, sections.map((s) => s.id)),
    loadAllSlots(supabase, institutionId, input.versionId),
  ]);

  const { suggestions, unfilled, truncated } = suggestFill({
    periods,
    sections,
    assignments,
    slots,
    rooms,
    maxPeriodsWeek: maxPeriodsPerWeek(ctx),
    limit: input.limit,
  });

  return { versionId: input.versionId, engineVersion: SUGGEST_ENGINE_VERSION, suggestions, unfilled, truncated };
}
