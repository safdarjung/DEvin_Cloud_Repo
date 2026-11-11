import "server-only";
// 0140 study-help sources, read under the caller's own RLS client:
//   file             a curriculum_materials upload: a student's OWN private
//                    file or a class file of their own subjects; a teacher's
//                    class file of a subject they teach, or their own upload.
//                    Ownership/visibility is re-checked here on top of RLS
//                    (RLS also shows guardians' children's files and pending
//                    suggestions to teachers: neither may be read by the AI).
//                    Bytes come through a short signed URL made with the
//                    caller's own storage access; never a client-supplied URL.
//   weak_units       the student's weakest units (weak-units.ts).
//   class_weak_units a taught section's weakest units: aggregates only, the
//                    prompt carries unit titles and outlines, never students.
import { AppError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { FILE_READ_MAX_BYTES } from "@/lib/ai/file-input";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { myPracticeAttempts } from "@/modules/practice/queries";
import { matchesMagic } from "@/modules/textbooks/file-check";
import { names, studentSection, type Client, type ResolvedSource } from "@/modules/study/sources";
import { selectWeakUnits, type MasteryEvidence, type UnitEvidence, type UnitInfo } from "@/modules/study/weak-units";

const BUCKET = "tenant-docs";
const SIGNED_URL_SECONDS = 30;

const notFound = (what = "That file was not found."): never => {
  throw new AppError("not_found", what);
};

export async function fileSource(supabase: Client, ctx: TenantContext, materialId: string, audience: "student" | "teacher"): Promise<ResolvedSource> {
  const { data: m, error } = await supabase
    .from("curriculum_materials")
    .select("id, title, grade_id, subject_id, curriculum_unit_id, owner_kind, student_id, visibility, created_by")
    .eq("id", materialId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!m) return notFound();

  const own = m.created_by === ctx.user.id;
  if (audience === "student") {
    const ownShelf = m.owner_kind === "student" && m.student_id === ctx.membership.studentId && own;
    if (!ownShelf && m.visibility !== "class") return notFound();
    if (m.visibility === "class" && !ownShelf) {
      // A class file of a subject taught in the student's own section (RLS says the same; proved again here).
      const sectionId = await studentSection(supabase, ctx);
      const { data: assigned, error: aError } = await supabase
        .from("subject_assignments")
        .select("id")
        .eq("institution_id", ctx.institution.id)
        .eq("class_section_id", sectionId!)
        .eq("subject_id", m.subject_id ?? "")
        .limit(1)
        .maybeSingle();
      if (aError) throw aError;
      if (!assigned) return notFound();
    }
  } else if (!own) {
    // A student's private file (e.g. one suggested for review) is never read by the AI for a teacher;
    // a class file only for a (grade, subject) the teacher teaches.
    if (m.visibility !== "class" || !m.grade_id || !m.subject_id) return notFound();
    if (!(await teachesGradeSubject(supabase, ctx, m.grade_id, m.subject_id))) return notFound();
  }

  const file = await fetchDocumentBytes(supabase, ctx, "curriculum_material", m.id);

  const n = await names(supabase, m.grade_id, m.subject_id);
  return {
    title: m.title,
    sourceLabel: "the attached file (read it; it is the source)",
    lines: [`File: ${m.title}`, "Work from the attached file. If it is not study material, say so in the output and keep to the academic topic."],
    ...n,
    subjectId: m.subject_id,
    unitId: m.curriculum_unit_id,
    resourceId: null,
    sourceMaterialId: m.id,
    file,
  };
}

/**
 * An active document's bytes through a short signed URL made with the caller's
 * own storage access (documents RLS decides; never a client-supplied URL),
 * checked against the read cap and the declared type's magic bytes.
 */
export async function fetchDocumentBytes(
  supabase: Client,
  ctx: TenantContext,
  entityType: "curriculum_material" | "subject_textbook",
  entityId: string,
): Promise<{ bytes: Uint8Array; mime: string; fileName: string }> {
  const { data: doc, error: dError } = await supabase
    .from("documents")
    .select("path, mime, size_bytes, file_name")
    .eq("institution_id", ctx.institution.id)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (dError) throw dError;
  if (!doc) return notFound();
  if (doc.size_bytes > FILE_READ_MAX_BYTES) {
    throw new AppError("validation_failed", `This file is over ${FILE_READ_MAX_BYTES / 1024 / 1024} MB, too big to read. Upload one chapter.`);
  }
  const { data: signed, error: sError } = await supabase.storage.from(BUCKET).createSignedUrl(doc.path, SIGNED_URL_SECONDS);
  if (sError || !signed) return notFound();
  const res = await fetch(signed.signedUrl, { cache: "no-store" });
  if (!res.ok) throw new AppError("dependency_failed", "The file could not be fetched from storage. Try again.");
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > FILE_READ_MAX_BYTES) throw new AppError("validation_failed", "This file is too big to read.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > FILE_READ_MAX_BYTES) throw new AppError("validation_failed", "This file is too big to read.");
  if (!matchesMagic(doc.mime, bytes.slice(0, 8))) throw new AppError("validation_failed", "That file is not a readable PDF, JPEG or PNG.");
  return { bytes, mime: doc.mime, fileName: doc.file_name };
}

/** (grade, subject) pairs the teacher teaches through subject_assignments. */
export async function taughtGradeSubjects(supabase: Client, ctx: TenantContext): Promise<{ gradeId: string; subjectId: string; sectionId: string }[]> {
  if (!ctx.membership.staffId) return [];
  const { data, error } = await supabase
    .from("subject_assignments")
    .select("subject_id, class_section_id, class_sections(grade_id)")
    .eq("institution_id", ctx.institution.id)
    .eq("teacher_id", ctx.membership.staffId);
  if (error) throw error;
  return (data ?? []).flatMap((r) => {
    const gradeId = (r.class_sections as { grade_id: string } | null)?.grade_id;
    return gradeId ? [{ gradeId, subjectId: r.subject_id, sectionId: r.class_section_id }] : [];
  });
}

async function teachesGradeSubject(supabase: Client, ctx: TenantContext, gradeId: string, subjectId: string): Promise<boolean> {
  return (await taughtGradeSubjects(supabase, ctx)).some((p) => p.gradeId === gradeId && p.subjectId === subjectId);
}

interface UnitRow {
  id: string;
  title: string;
  description: string | null;
  subject_id: string;
}

async function unitsFor(supabase: Client, ctx: TenantContext, gradeId: string, subjectIds: readonly string[]): Promise<UnitRow[]> {
  if (subjectIds.length === 0) return [];
  const { data, error } = await supabase
    .from("curriculum_units")
    .select("id, title, description, subject_id")
    .eq("institution_id", ctx.institution.id)
    .eq("grade_id", gradeId)
    .in("subject_id", [...subjectIds])
    .order("sequence")
    .limit(400);
  if (error) throw error;
  return data ?? [];
}

async function sectionGrade(supabase: Client, ctx: TenantContext, sectionId: string): Promise<{ gradeId: string; label: string }> {
  const { data, error } = await supabase.from("class_sections").select("grade_id, name, grades(display_name)").eq("id", sectionId).eq("institution_id", ctx.institution.id).maybeSingle();
  if (error) throw error;
  if (!data) return notFound("That class section was not found.");
  return { gradeId: data.grade_id, label: `${(data.grades as { display_name: string } | null)?.display_name ?? ""} ${data.name}`.trim() };
}

async function subjectNames(supabase: Client, ctx: TenantContext, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("subjects").select("id, name").eq("institution_id", ctx.institution.id).in("id", [...ids]);
  if (error) throw error;
  return new Map((data ?? []).map((s) => [s.id, s.name]));
}

/** The units a student may study (their section's subjects, their grade), with titles. */
export async function studentUnits(supabase: Client, ctx: TenantContext): Promise<{ units: (UnitInfo & { description: string | null })[]; gradeId: string; sectionId: string }> {
  const sectionId = (await studentSection(supabase, ctx))!;
  const { gradeId } = await sectionGrade(supabase, ctx, sectionId);
  const { data: subs, error } = await supabase.from("subject_assignments").select("subject_id").eq("institution_id", ctx.institution.id).eq("class_section_id", sectionId);
  if (error) throw error;
  const subjectIds = [...new Set((subs ?? []).map((s) => s.subject_id))];
  const [rows, subjects] = await Promise.all([unitsFor(supabase, ctx, gradeId, subjectIds), subjectNames(supabase, ctx, subjectIds)]);
  return { gradeId, sectionId, units: rows.map((u) => ({ id: u.id, title: u.title, description: u.description, subjectId: u.subject_id, subjectName: subjects.get(u.subject_id) ?? "" })) };
}

/** The student's own practice + studio quiz + mastery evidence (their RLS: own rows). */
export async function studentEvidence(supabase: Client, ctx: TenantContext, studentId: string): Promise<{ evidence: UnitEvidence[]; mastery: MasteryEvidence[] }> {
  const [practice, studio, mastery] = await Promise.all([
    isModuleEnabled(ctx, "practice") ? myPracticeAttempts(ctx, studentId) : Promise.resolve([]),
    supabase
      .from("study_quiz_attempts")
      .select("curriculum_unit_id, auto_score, auto_max, ai_points, ai_max, created_at")
      .eq("institution_id", ctx.institution.id)
      .eq("student_id", studentId)
      .not("curriculum_unit_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("mastery_snapshots").select("curriculum_unit_id, score, confidence, computed_at").eq("institution_id", ctx.institution.id).eq("student_id", studentId).limit(400),
  ]);
  if (studio.error || mastery.error) throw studio.error ?? mastery.error;
  return {
    evidence: [
      ...practice.flatMap((p) => (p.curriculumUnitId ? [{ unitId: p.curriculumUnitId, correct: p.score, total: p.maxScore, at: p.createdAt }] : [])),
      ...(studio.data ?? []).map((a) => ({ unitId: a.curriculum_unit_id!, correct: a.auto_score + a.ai_points / 2, total: a.auto_max + a.ai_max / 2, at: a.created_at })),
    ],
    mastery: (mastery.data ?? []).map((r) => ({ unitId: r.curriculum_unit_id, score: Number(r.score), confidence: Number(r.confidence), computedAt: r.computed_at })),
  };
}

function packLines(units: readonly (UnitInfo & { description: string | null })[], who: string): string[] {
  return [
    `${who} These units are listed weakest first:`,
    ...units.flatMap((u, i) => [`Unit ${i + 1}: ${u.title} (${u.subjectName})`, `Outline: ${u.description ?? "(no outline written; use the unit title)"}`]),
    "Cover every listed unit, giving more space to the first ones. Do not mention scores or any person.",
  ];
}

export async function weakUnitsSource(supabase: Client, ctx: TenantContext): Promise<ResolvedSource> {
  const studentId = ctx.membership.studentId;
  if (!studentId) throw new AppError("forbidden", "A revision pack is made from your own practice.");
  const [{ units }, { evidence, mastery }] = await Promise.all([studentUnits(supabase, ctx), studentEvidence(supabase, ctx, studentId)]);
  const weak = selectWeakUnits({ allowed: units, evidence, mastery, now: new Date() });
  if (weak.length === 0) {
    throw new AppError("validation_failed", "No weak topics yet. Take a practice quiz or a studio quiz on a few units first, then build a pack.");
  }
  const chosen = weak.map((w) => units.find((u) => u.id === w.unitId)!);
  const subjectIds = [...new Set(chosen.map((u) => u.subjectId))];
  return {
    title: `Revision pack: ${chosen.map((u) => u.title).join(", ")}`.slice(0, 150),
    sourceLabel: "the student's weakest curriculum units (titles and outlines)",
    lines: packLines(chosen, "A student is revising the units they find hardest."),
    gradeLabel: null,
    subjectName: subjectIds.length === 1 ? chosen[0]!.subjectName : null,
    subjectId: subjectIds.length === 1 ? subjectIds[0]! : null,
    unitId: chosen.length === 1 ? chosen[0]!.id : null,
    resourceId: null,
    focusUnitIds: chosen.map((u) => u.id),
  };
}

export async function classWeakUnitsSource(supabase: Client, ctx: TenantContext, sectionId: string): Promise<ResolvedSource> {
  const staffId = ctx.membership.staffId;
  if (!staffId) throw new AppError("forbidden", "Only a teacher makes a class revision pack.");
  const { data: taught, error } = await supabase
    .from("subject_assignments")
    .select("subject_id")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", sectionId)
    .eq("teacher_id", staffId);
  if (error) throw error;
  const subjectIds = [...new Set((taught ?? []).map((t) => t.subject_id))];
  if (subjectIds.length === 0) return notFound("You do not teach that section.");
  const grade = await sectionGrade(supabase, ctx, sectionId);
  const [rows, subjects] = await Promise.all([unitsFor(supabase, ctx, grade.gradeId, subjectIds), subjectNames(supabase, ctx, subjectIds)]);
  const units = rows.map((u) => ({ id: u.id, title: u.title, description: u.description, subjectId: u.subject_id, subjectName: subjects.get(u.subject_id) ?? "" }));
  const unitIds = units.map((u) => u.id);
  if (unitIds.length === 0) return notFound("No curriculum units for that section yet.");

  // Teacher RLS: practice rows and mastery snapshots of students they teach. Summed per unit; no student leaves this function.
  const { data: roster, error: rError } = await supabase.from("enrolments").select("student_id").eq("institution_id", ctx.institution.id).eq("class_section_id", sectionId).eq("status", "active").limit(200);
  if (rError) throw rError;
  const studentIds = (roster ?? []).map((r) => r.student_id);
  const [practice, mastery] = await Promise.all([
    studentIds.length && isModuleEnabled(ctx, "practice")
      ? supabase.from("practice_attempts").select("curriculum_unit_id, score, max_score, created_at").eq("institution_id", ctx.institution.id).in("student_id", studentIds).in("curriculum_unit_id", unitIds).limit(2000)
      : Promise.resolve({ data: [] as { curriculum_unit_id: string | null; score: number; max_score: number; created_at: string }[], error: null }),
    supabase.from("mastery_snapshots").select("curriculum_unit_id, score, confidence, computed_at").eq("institution_id", ctx.institution.id).eq("class_section_id", sectionId).in("curriculum_unit_id", unitIds).limit(4000),
  ]);
  if (practice.error || mastery.error) throw practice.error ?? mastery.error;
  // Section mastery: the mean per unit (one aggregate snapshot per unit, newest timestamp).
  const byUnit = new Map<string, { sum: number; conf: number; n: number; at: string }>();
  for (const r of mastery.data ?? []) {
    const s = byUnit.get(r.curriculum_unit_id) ?? { sum: 0, conf: 0, n: 0, at: r.computed_at };
    byUnit.set(r.curriculum_unit_id, { sum: s.sum + Number(r.score), conf: s.conf + Number(r.confidence), n: s.n + 1, at: r.computed_at > s.at ? r.computed_at : s.at });
  }
  const weak = selectWeakUnits({
    allowed: units,
    evidence: (practice.data ?? []).flatMap((p) => (p.curriculum_unit_id ? [{ unitId: p.curriculum_unit_id, correct: p.score, total: p.max_score, at: p.created_at }] : [])),
    mastery: [...byUnit.entries()].map(([unitId, s]) => ({ unitId, score: s.sum / s.n, confidence: s.conf / s.n, computedAt: s.at })),
    now: new Date(),
  });
  if (weak.length === 0) throw new AppError("validation_failed", "Not enough practice or mastery data for this section yet to find its weakest units.");
  const chosen = weak.map((w) => units.find((u) => u.id === w.unitId)!);
  const one = new Set(chosen.map((u) => u.subjectId)).size === 1;
  return {
    title: `Class revision pack (${grade.label}): ${chosen.map((u) => u.title).join(", ")}`.slice(0, 150),
    sourceLabel: "the class's weakest curriculum units (titles and outlines only)",
    lines: packLines(chosen, "A teacher is preparing revision for a class on the units the class finds hardest."),
    gradeLabel: null,
    subjectName: one ? chosen[0]!.subjectName : null,
    subjectId: one ? chosen[0]!.subjectId : null,
    unitId: chosen.length === 1 ? chosen[0]!.id : null,
    resourceId: null,
    focusUnitIds: chosen.map((u) => u.id),
  };
}

/** 0140 item 8 (teacher): chosen units of (grade, subject) pairs the teacher teaches, with any linked chapter. Outlines only. */
export async function teacherUnitsSource(supabase: Client, ctx: TenantContext, unitIds: readonly string[]): Promise<ResolvedSource> {
  const taught = await taughtGradeSubjects(supabase, ctx);
  const { data, error } = await supabase
    .from("curriculum_units")
    .select("id, title, description, grade_id, subject_id, sequence")
    .eq("institution_id", ctx.institution.id)
    .in("id", [...unitIds])
    .order("sequence");
  if (error) throw error;
  const units = (data ?? []).filter((u) => taught.some((p) => p.gradeId === u.grade_id && p.subjectId === u.subject_id));
  if (units.length !== new Set(unitIds).size) return notFound("Pick units of subjects you teach.");
  const { data: chapters, error: cError } = await supabase
    .from("curriculum_unit_chapters")
    .select("curriculum_unit_id, chapter_no")
    .eq("institution_id", ctx.institution.id)
    .in("curriculum_unit_id", units.map((u) => u.id));
  if (cError) throw cError;
  const chapterOf = new Map((chapters ?? []).map((c) => [c.curriculum_unit_id, c.chapter_no]));
  const one = new Set(units.map((u) => u.subject_id)).size === 1;
  const n = await names(supabase, units[0]!.grade_id, one ? units[0]!.subject_id : null);
  return {
    title: units.map((u) => u.title).join(", ").slice(0, 140),
    sourceLabel: "curriculum units the teacher chose (titles, outlines and chapter numbers; the AI has NOT read the textbook)",
    lines: units.flatMap((u) => [`Unit: ${u.title}${chapterOf.has(u.id) ? ` [textbook chapter ${chapterOf.get(u.id)}]` : ""}`, `Outline: ${u.description ?? "(no outline written; use the unit title)"}`]),
    ...n,
    subjectId: one ? units[0]!.subject_id : null,
    unitId: units.length === 1 ? units[0]!.id : null,
    resourceId: null,
    focusUnitIds: units.map((u) => u.id),
  };
}
