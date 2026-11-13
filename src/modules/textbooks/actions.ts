"use server";

// textbook.* (migration 0139): a school's (grade, subject) -> textbook mapping,
// its own chapter titles, and unit -> chapter links. Plain table writes
// under RLS (leaders any pair; a teacher only pairs they teach), gated by
// resource.manage (leaders + teachers). NCERT books are links to
// ncert.nic.in only; nothing here fetches or stores a PDF.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { proposeMapping } from "./ncert";
import { loadCatalogue, mappablePairs } from "./catalogue";
import {
  AddTextbookSchema,
  SetChapterTitlesSchema,
  SetUnitChapterSchema,
  SuggestNcertSchema,
  TextbookIdSchema,
  UpdateTextbookMetaSchema,
  type AddTextbookInput,
  type SetChapterTitlesInput,
  type SetUnitChapterInput,
  type SuggestNcertInput,
  type TextbookIdInput,
  type UpdateTextbookMetaInput,
} from "./schemas";

type Client = Awaited<ReturnType<typeof createClient>>;

function throwWrite(error: { code?: string | null }, forbidden: string): never {
  if (error.code === "42501") throw new AppError("forbidden", forbidden);
  if (error.code === "23505") throw new AppError("conflict", "That book is already mapped here.");
  if (error.code === "23503") throw new AppError("not_found", "Grade, subject or book not found.");
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const suggestNcertBooks = defineAction({
  name: "textbook.suggestNcert",
  module: "academic_structure",
  schema: SuggestNcertSchema,
  permission: "resource.manage",
  handler: async (_input: SuggestNcertInput, ctx) => {
    const supabase = await createClient();
    const [pairs, catalogue, existing] = await Promise.all([
      mappablePairs(supabase, ctx),
      loadCatalogue(supabase),
      supabase.from("subject_textbooks").select("grade_id, subject_id").eq("institution_id", ctx.institution.id),
    ]);
    if (existing.error) throw existing.error;
    // A pair the school already mapped (NCERT or its own book) is its choice: leave it.
    const mapped = new Set((existing.data ?? []).map((r) => `${r.grade_id}:${r.subject_id}`));
    const rows = proposeMapping(
      pairs.filter((p) => !mapped.has(`${p.gradeId}:${p.subjectId}`)),
      catalogue,
    ).flatMap((p) =>
      p.codes.map((code, position) => ({
        institution_id: ctx.institution.id,
        grade_id: p.gradeId,
        subject_id: p.subjectId,
        ncert_code: code,
        position,
        created_by: ctx.user.id,
      })),
    );
    if (rows.length > 0) {
      const { error } = await supabase.from("subject_textbooks").insert(rows);
      if (error) throwWrite(error, "You cannot map books for one of these subjects.");
    }
    await audit(ctx, { action: "textbook.suggest_ncert", entityType: "subject_textbook", after: { added: rows.length } });
    return { added: rows.length, pairsChecked: pairs.length };
  },
});

export const addTextbook = defineAction({
  name: "textbook.add",
  module: "academic_structure",
  schema: AddTextbookSchema,
  permission: "resource.manage",
  handler: async (input: AddTextbookInput, ctx) => {
    const supabase = await createClient();
    const { count, error: countError } = await supabase
      .from("subject_textbooks")
      .select("id", { count: "exact", head: true })
      .eq("institution_id", ctx.institution.id)
      .eq("grade_id", input.gradeId)
      .eq("subject_id", input.subjectId);
    if (countError) throw countError;
    const book =
      input.book.source === "ncert"
        ? { ncert_code: input.book.code, school_url: input.book.schoolUrl ?? null }
        : {
            custom_title: input.book.title,
            custom_publisher: input.book.publisher ?? null,
            custom_url: input.book.url ?? null,
            custom_chapters: input.book.chapters ?? null,
          };
    const { data, error } = await supabase
      .from("subject_textbooks")
      .insert({
        institution_id: ctx.institution.id,
        grade_id: input.gradeId,
        subject_id: input.subjectId,
        position: Math.min(count ?? 0, 99),
        created_by: ctx.user.id,
        ...book,
      })
      .select("id")
      .single();
    if (error) throwWrite(error, "You can only add books for subjects you teach.");
    await audit(ctx, { action: "textbook.add", entityType: "subject_textbook", entityId: data.id, after: { source: input.book.source } });
    return { id: data.id };
  },
});

export const removeTextbook = defineAction({
  name: "textbook.remove",
  module: "academic_structure",
  schema: TextbookIdSchema,
  permission: "resource.manage",
  handler: async ({ textbookId }: TextbookIdInput, ctx) => {
    const supabase = await createClient();
    // Retire the school's PDF first (same who-may rule as the row), so no live file outlives its book.
    const { error: fileError } = await supabase
      .from("documents")
      .update({ status: "deleted" })
      .eq("entity_type", "subject_textbook")
      .eq("entity_id", textbookId)
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active");
    if (fileError) throwWrite(fileError, "You cannot remove that book.");
    const { data, error } = await supabase
      .from("subject_textbooks")
      .delete()
      .eq("id", textbookId)
      .eq("institution_id", ctx.institution.id)
      .select("id");
    if (error) throwWrite(error, "You cannot remove that book.");
    if (!data?.length) throw new AppError("not_found", "Book not found.");
    await audit(ctx, { action: "textbook.remove", entityType: "subject_textbook", entityId: textbookId });
    return { id: textbookId };
  },
});

async function bookChapters(supabase: Client, ctx: TenantContext, textbookId: string) {
  const { data, error } = await supabase
    .from("subject_textbooks")
    .select("id, grade_id, subject_id, chapter_titles, custom_chapters, ncert_textbooks(chapters_count)")
    .eq("id", textbookId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("not_found", "Book not found.");
  const ncert = data.ncert_textbooks as { chapters_count: number } | null;
  return { row: data, chapters: ncert?.chapters_count ?? data.custom_chapters ?? 99 };
}

export const setChapterTitles = defineAction({
  name: "textbook.chapterTitles.set",
  module: "academic_structure",
  schema: SetChapterTitlesSchema,
  permission: "resource.manage",
  handler: async ({ textbookId, titles }: SetChapterTitlesInput, ctx) => {
    const supabase = await createClient();
    const { row, chapters } = await bookChapters(supabase, ctx, textbookId);
    const next: Record<string, string> = { ...((row.chapter_titles as Record<string, string> | null) ?? {}) };
    for (const [no, value] of Object.entries(titles)) {
      if (Number(no) > chapters) throw new AppError("validation_failed", `This book has ${chapters} chapters.`, { titles: [`Chapter ${no} does not exist`] });
      if (value) next[no] = value;
      else delete next[no];
    }
    const { data, error } = await supabase.from("subject_textbooks").update({ chapter_titles: next }).eq("id", textbookId).select("id");
    if (error) throwWrite(error, "You can only name chapters of books for subjects you teach.");
    if (!data?.length) throw new AppError("forbidden", "You can only name chapters of books for subjects you teach.");
    await audit(ctx, { action: "textbook.chapter_titles_set", entityType: "subject_textbook", entityId: textbookId });
    return { id: textbookId, titles: next };
  },
});

export const setUnitChapter = defineAction({
  name: "textbook.unitChapter.set",
  module: "academic_structure",
  schema: SetUnitChapterSchema,
  permission: "resource.manage",
  handler: async (input: SetUnitChapterInput, ctx) => {
    const supabase = await createClient();
    const { data: unit, error: unitError } = await supabase
      .from("curriculum_units")
      .select("id, grade_id, subject_id")
      .eq("id", input.unitId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (unitError) throw unitError;
    if (!unit) throw new AppError("not_found", "Unit not found.");

    if (input.chapterNo === null) {
      const { error } = await supabase.from("curriculum_unit_chapters").delete().eq("curriculum_unit_id", unit.id);
      if (error) throwWrite(error, "You can only link chapters for subjects you teach.");
      await audit(ctx, { action: "textbook.unit_chapter_clear", entityType: "curriculum_unit", entityId: unit.id });
      return { unitId: unit.id, chapterNo: null };
    }

    const { row, chapters } = await bookChapters(supabase, ctx, input.textbookId!);
    if (row.grade_id !== unit.grade_id || row.subject_id !== unit.subject_id) {
      throw new AppError("validation_failed", "That book is not mapped to this unit's grade and subject.", { textbookId: ["Not this unit's book"] });
    }
    if (input.chapterNo > chapters) throw new AppError("validation_failed", `This book has ${chapters} chapters.`, { chapterNo: [`1 to ${chapters}`] });

    const { data: existing, error: existingError } = await supabase
      .from("curriculum_unit_chapters")
      .select("curriculum_unit_id")
      .eq("curriculum_unit_id", unit.id)
      .maybeSingle();
    if (existingError) throw existingError;
    const { data, error } = existing
      ? await supabase
          .from("curriculum_unit_chapters")
          .update({ subject_textbook_id: row.id, chapter_no: input.chapterNo })
          .eq("curriculum_unit_id", unit.id)
          .select("curriculum_unit_id")
      : await supabase
          .from("curriculum_unit_chapters")
          .insert({
            curriculum_unit_id: unit.id,
            institution_id: ctx.institution.id,
            grade_id: unit.grade_id,
            subject_id: unit.subject_id,
            subject_textbook_id: row.id,
            chapter_no: input.chapterNo,
            created_by: ctx.user.id,
          })
          .select("curriculum_unit_id");
    if (error) throwWrite(error, "You can only link chapters for subjects you teach.");
    if (!data?.length) throw new AppError("forbidden", "You can only link chapters for subjects you teach.");
    await audit(ctx, { action: "textbook.unit_chapter_set", entityType: "curriculum_unit", entityId: unit.id, after: { chapterNo: input.chapterNo } });
    return { unitId: unit.id, chapterNo: input.chapterNo };
  },
});

/** Edition / ISBN / board / rights (0147). NCERT rows stay link-only: SQL forces it, so the action refuses to pretend otherwise. */
export const updateTextbookMeta = defineAction({
  name: "textbook.meta.update",
  module: "academic_structure",
  schema: UpdateTextbookMetaSchema,
  permission: "resource.manage",
  handler: async (input: UpdateTextbookMetaInput, ctx) => {
    const supabase = await createClient();
    const { data: book, error: readError } = await supabase.from("subject_textbooks").select("id, ncert_code").eq("id", input.textbookId).eq("institution_id", ctx.institution.id).maybeSingle();
    if (readError) throw readError;
    if (!book) throw new AppError("not_found", "Book not found.");
    if (book.ncert_code && input.rightsStatus !== "link_only") throw new AppError("validation_failed", "NCERT books are link only.", { rightsStatus: ["NCERT books are link only"] });
    const { data, error } = await supabase
      .from("subject_textbooks")
      .update({ edition: input.edition, publication_year: input.publicationYear, isbn: input.isbn, board: input.board, rights_status: input.rightsStatus, permitted_use: input.permittedUse })
      .eq("id", input.textbookId)
      .eq("institution_id", ctx.institution.id)
      .select("id");
    if (error) throwWrite(error, "You can only change books for subjects you teach.");
    if (!data?.length) throw new AppError("forbidden", "You can only change books for subjects you teach.");
    await audit(ctx, { action: "textbook.meta_update", entityType: "subject_textbook", entityId: input.textbookId, after: { rightsStatus: input.rightsStatus } });
    return { id: input.textbookId };
  },
});
