import "server-only";
// Curriculum materials (0139): the school's own uploaded files. Metadata
// only (no path, no signed URL — bytes go through curriculum.material.readUrl).
// Caller's client: curriculum_materials RLS decides what is visible, and the
// documents rows of a material are exactly as visible as the material.
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { mappablePairs } from "./catalogue";
import type { PanelItem } from "./components/MaterialsPanel";

type Client = Awaited<ReturnType<typeof createClient>>;

export interface MaterialItem {
  id: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  mime: string;
  createdAt: string;
  gradeId: string | null;
  subjectId: string | null;
  unitId: string | null;
  visibility: "private" | "class";
  suggestion: "none" | "suggested" | "approved" | "declined";
  ownerKind: "staff" | "student";
  mine: boolean;
}

const COLUMNS = "id, title, grade_id, subject_id, curriculum_unit_id, visibility, suggestion, owner_kind, created_by, created_at";

interface MaterialFilter {
  visibility?: "private" | "class";
  suggestion?: "suggested";
  gradeId?: string;
  subjectId?: string;
  unitId?: string;
  studentId?: string;
  createdBy?: string;
  unfiled?: boolean;
  /** With studentId: also the student's unfiled files. */
  subjectOrUnfiled?: string;
}

/** Materials (with an active file) matching `f`, newest first, capped at 100. */
async function listMaterials(supabase: Client, ctx: TenantContext, f: MaterialFilter): Promise<MaterialItem[]> {
  let q = supabase.from("curriculum_materials").select(COLUMNS).eq("institution_id", ctx.institution.id);
  if (f.visibility) q = q.eq("visibility", f.visibility);
  if (f.suggestion) q = q.eq("suggestion", f.suggestion);
  if (f.gradeId) q = q.eq("grade_id", f.gradeId);
  if (f.subjectId) q = q.eq("subject_id", f.subjectId);
  if (f.unitId) q = q.eq("curriculum_unit_id", f.unitId);
  if (f.studentId) q = q.eq("owner_kind", "student").eq("student_id", f.studentId);
  if (f.createdBy) q = q.eq("created_by", f.createdBy);
  if (f.unfiled) q = q.is("subject_id", null);
  if (f.subjectOrUnfiled) q = q.or(`subject_id.eq.${f.subjectOrUnfiled},subject_id.is.null`);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    id: string;
    title: string;
    grade_id: string | null;
    subject_id: string | null;
    curriculum_unit_id: string | null;
    visibility: MaterialItem["visibility"];
    suggestion: MaterialItem["suggestion"];
    owner_kind: MaterialItem["ownerKind"];
    created_by: string;
    created_at: string;
  }[];
  if (rows.length === 0) return [];
  const { data: docs, error: docError } = await supabase
    .from("documents")
    .select("entity_id, file_name, size_bytes, mime")
    .eq("institution_id", ctx.institution.id)
    .eq("entity_type", "curriculum_material")
    .eq("status", "active")
    .in(
      "entity_id",
      rows.map((r) => r.id),
    );
  if (docError) throw docError;
  const byMaterial = new Map((docs ?? []).map((d) => [d.entity_id, d]));
  return rows.flatMap((r) => {
    const doc = byMaterial.get(r.id);
    if (!doc) return []; // upload never confirmed
    return [
      {
        id: r.id,
        title: r.title,
        fileName: doc.file_name,
        sizeBytes: doc.size_bytes,
        mime: doc.mime,
        createdAt: r.created_at,
        gradeId: r.grade_id,
        subjectId: r.subject_id,
        unitId: r.curriculum_unit_id,
        visibility: r.visibility,
        suggestion: r.suggestion,
        ownerKind: r.owner_kind,
        mine: r.created_by === ctx.user.id,
      },
    ];
  });
}

/** Class materials of a grade, optionally one subject or unit. */
export async function classMaterials(ctx: TenantContext, p: { gradeId: string; subjectId?: string; unitId?: string }): Promise<MaterialItem[]> {
  const supabase = await createClient();
  return listMaterials(supabase, ctx, { visibility: "class", gradeId: p.gradeId, subjectId: p.subjectId, unitId: p.unitId });
}

/** A student's private shelf (own, or a linked child's for a guardian; RLS decides), optionally one subject. */
export async function studentShelf(ctx: TenantContext, p: { studentId: string; subjectId?: string }): Promise<MaterialItem[]> {
  const supabase = await createClient();
  return listMaterials(supabase, ctx, { visibility: "private", studentId: p.studentId, subjectOrUnfiled: p.subjectId });
}

/** The caller's own unfiled uploads (chat attach waiting for a place). */
export async function myUnfiled(ctx: TenantContext): Promise<MaterialItem[]> {
  const supabase = await createClient();
  return listMaterials(supabase, ctx, { createdBy: ctx.user.id, unfiled: true });
}

/** Suggestions waiting for the caller's review (RLS: subject teacher or leader), optionally one unit's (grade, subject). */
export async function suggestionsToReview(ctx: TenantContext, p: { gradeId?: string; subjectId?: string } = {}): Promise<MaterialItem[]> {
  const supabase = await createClient();
  return listMaterials(supabase, ctx, { suggestion: "suggested", gradeId: p.gradeId, subjectId: p.subjectId });
}

export interface AttachTarget {
  gradeId: string;
  gradeName: string;
  subjectId: string;
  subjectName: string;
  units: { id: string; title: string }[];
}

const MAX_TARGET_UNITS = 60;

/** Where the caller may file an upload: a teacher's taught (grade, subject) pairs, a student's own section subjects; with their units (capped). */
export async function attachTargets(ctx: TenantContext): Promise<AttachTarget[]> {
  const supabase = await createClient();
  let pairs: { gradeId: string; gradeName: string; subjectId: string; subjectName: string }[];
  if (ctx.membership.role === "student") {
    if (!ctx.membership.studentId) return [];
    const { data: enrolment, error } = await supabase
      .from("enrolments")
      .select("class_section_id, class_sections(grade_id, grades(display_name))")
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", ctx.membership.studentId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const section = enrolment?.class_sections as { grade_id: string; grades: { display_name: string } | null } | null;
    if (!enrolment || !section) return [];
    const { data: subjects, error: sError } = await supabase
      .from("subject_assignments")
      .select("subject_id, subjects(name)")
      .eq("institution_id", ctx.institution.id)
      .eq("class_section_id", enrolment.class_section_id);
    if (sError) throw sError;
    pairs = (subjects ?? []).map((s) => ({
      gradeId: section.grade_id,
      gradeName: section.grades?.display_name ?? "Grade",
      subjectId: s.subject_id,
      subjectName: (s.subjects as { name: string } | null)?.name ?? "Subject",
    }));
  } else {
    pairs = (await mappablePairs(supabase, ctx)).map((p) => ({ gradeId: p.gradeId, gradeName: p.gradeName, subjectId: p.subjectId, subjectName: p.subjectName }));
  }
  const unique = [...new Map(pairs.map((p) => [`${p.gradeId}:${p.subjectId}`, p])).values()];
  if (unique.length === 0) return [];
  const { data: units, error: uError } = await supabase
    .from("curriculum_units")
    .select("id, title, grade_id, subject_id, sequence")
    .eq("institution_id", ctx.institution.id)
    .in("grade_id", [...new Set(unique.map((p) => p.gradeId))])
    .in("subject_id", [...new Set(unique.map((p) => p.subjectId))])
    .order("sequence")
    .limit(MAX_TARGET_UNITS * 4);
  if (uError) throw uError;
  let budget = MAX_TARGET_UNITS;
  return unique
    .sort((a, b) => a.gradeName.localeCompare(b.gradeName) || a.subjectName.localeCompare(b.subjectName))
    .map((p) => {
      const mine = (units ?? []).filter((u) => u.grade_id === p.gradeId && u.subject_id === p.subjectId).slice(0, Math.max(budget, 0));
      budget -= mine.length;
      return { ...p, units: mine.map((u) => ({ id: u.id, title: u.title })) };
    });
}

/** List rows for MaterialsPanel: who may delete, suggest or review each file (UX only; actions re-check). */
export function panelItems(
  items: MaterialItem[],
  viewer: { isStudent: boolean; canReview: boolean; canManageClass: boolean },
): PanelItem[] {
  return items.map((m) => ({
    id: m.id,
    title: m.title,
    fileName: m.fileName,
    sizeBytes: m.sizeBytes,
    createdAt: m.createdAt,
    visibility: m.visibility,
    suggestion: m.suggestion,
    canDelete: m.mine || (m.visibility === "class" && viewer.canManageClass),
    canSuggest: viewer.isStudent && m.mine && m.ownerKind === "student" && m.subjectId !== null && m.visibility === "private",
    canReview: viewer.canReview && !m.mine && m.suggestion === "suggested",
  }));
}
