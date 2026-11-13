"use server";

// Phase 3 (15-learning-exam-system-plan.md) — question paper builder.
// RLS (0149) scopes every write: leadership edits any paper, a teacher the
// papers they created within their taught (grade, subject) pairs.
// app.question_paper_guard / child guard freeze approved and published
// papers; status only moves through public.transition_question_paper, which
// re-runs app.validate_paper, so these actions are not the only wall.
// Rule 6: AI questions reach a paper only as bank questions (origin ai,
// draft) added by id; validation blocks approval until the bank approves them.
// In review, only approvers edit (the creator returns it to draft first).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import type { Json } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { QuestionCreateSchema, questionShapeColumns, type QuestionShape } from "@/modules/question-bank/schemas";
import { mapSectionsByTitle, seededShuffle, slots } from "@/modules/question-papers/paper-math";
import {
  AddItemsFromBankSchema,
  AddManualItemSchema,
  ApplyTemplateSchema,
  ApprovePaperSchema,
  ItemIdSchema,
  PaperCreateSchema,
  PaperIdSchema,
  PaperTransitionSchema,
  PaperUpdateSchema,
  ReorderItemsSchema,
  ReorderSectionsSchema,
  ReplaceItemSchema,
  SectionAddSchema,
  SectionUpdateSchema,
  SetChoiceGroupSchema,
  TemplateSaveSchema,
  UpdateItemSchema,
  type Blueprint,
  type PaperStatus,
} from "@/modules/question-papers/schemas";

const MODULE = "question_bank" as const;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

type Db = Awaited<ReturnType<typeof createClient>>;

async function loadPaper(db: Db, ctx: TenantContext, id: string) {
  const { data, error } = await db
    .from("question_papers")
    .select("id, grade_id, subject_id, status, blueprint")
    .eq("id", id)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Paper not found.");
  return data;
}

async function loadSection(db: Db, ctx: TenantContext, id: string) {
  const { data, error } = await db
    .from("question_paper_sections")
    .select("id, paper_id")
    .eq("id", id)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Section not found.");
  return { section: data, paper: await loadPaper(db, ctx, data.paper_id) };
}

async function loadItem(db: Db, ctx: TenantContext, id: string) {
  const { data, error } = await db
    .from("question_paper_items")
    .select("id, paper_id, section_id")
    .eq("id", id)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Question not found in this paper.");
  return { item: data, paper: await loadPaper(db, ctx, data.paper_id) };
}

async function nextPosition(db: Db, table: "question_paper_sections" | "question_paper_items", id: string) {
  const query =
    table === "question_paper_sections"
      ? db.from(table).select("position").eq("paper_id", id)
      : db.from(table).select("position").eq("section_id", id);
  const { data, error } = await query.order("position", { ascending: false }).limit(1);
  if (error) throwMapped(error);
  return data.length ? data[0].position + 1 : 0;
}

/** A 0-row write: RLS hid the row or the guard froze it; one message for both. */
function requireRow<T>(data: T | null, what: string): T {
  if (!data) throw new AppError("not_found", `${what} not found, or you cannot change it.`);
  return data;
}

// ---------------------------------------------------------------------------
// Snapshot columns
// ---------------------------------------------------------------------------

/** Bank row -> item snapshot columns (the paper keeps its own copy). */
const BANK_SNAPSHOT =
  "id, grade_id, subject_id, status, type, body, options, answer, answer_key, marks, explanation, marking_scheme, difficulty, curriculum_unit_id, curriculum_topic_id, source_subject_textbook_id, source_chapter_no, source_page";

type BankRow = {
  id: string;
  type: string;
  body: string;
  options: Json | null;
  answer: string;
  answer_key: Json | null;
  marks: number;
  explanation: string | null;
  marking_scheme: string | null;
  difficulty: string;
  curriculum_unit_id: string | null;
  curriculum_topic_id: string | null;
  source_subject_textbook_id: string | null;
  source_chapter_no: number | null;
  source_page: number | null;
};

function snapshotFromBank(q: BankRow) {
  return {
    source_question_id: q.id,
    type: q.type,
    body: q.body,
    options: q.options,
    answer: q.answer,
    answer_key: q.answer_key,
    marks: q.marks,
    explanation: q.explanation,
    marking_scheme: q.marking_scheme,
    difficulty: q.difficulty,
    curriculum_unit_id: q.curriculum_unit_id,
    curriculum_topic_id: q.curriculum_topic_id,
    source_subject_textbook_id: q.source_subject_textbook_id,
    source_chapter_no: q.source_chapter_no,
    source_page: q.source_page,
  };
}

/** Validates a manual item with the bank's own per-type rules (grade/subject come from the paper). */
function manualShape(raw: Record<string, unknown>, paper: { grade_id: string; subject_id: string }): QuestionShape {
  // origin/aiModel parse but are never stored: a manual item is human-authored by definition (rule 6).
  const parsed = QuestionCreateSchema.safeParse({ ...raw, gradeId: paper.grade_id, subjectId: paper.subject_id });
  if (!parsed.success) {
    const { fieldErrors } = parsed.error.flatten();
    throw new AppError("validation_failed", "Invalid question.", fieldErrors as Record<string, string[]>);
  }
  return parsed.data;
}

function snapshotFromShape(q: QuestionShape) {
  const shape = questionShapeColumns(q);
  return {
    type: q.type,
    body: q.body,
    options: shape.options as Json,
    answer: shape.answer,
    answer_key: shape.answer_key as Json,
    marks: q.marks,
    explanation: q.explanation ?? null,
    marking_scheme: q.markingScheme ?? null,
    difficulty: q.difficulty,
    curriculum_unit_id: q.curriculumUnitId ?? null,
    curriculum_topic_id: q.curriculumTopicId ?? null,
    source_subject_textbook_id: q.sourceSubjectTextbookId ?? null,
    source_chapter_no: q.sourceChapterNo ?? null,
    source_page: q.sourcePage ?? null,
  };
}

/** Inserts every blueprint section, positioned from `from`; returns their ids in blueprint order. */
async function sectionsFromBlueprint(db: Db, ctx: TenantContext, paperId: string, blueprint: Blueprint, from: number) {
  const rows = blueprint.sections.map((s, i) => ({
    institution_id: ctx.institution.id,
    paper_id: paperId,
    title: s.title,
    instructions: s.instructions ?? null,
    choose_count: s.chooseCount ?? null,
    position: from + i,
  }));
  if (!rows.length) return [];
  const { data, error } = await db.from("question_paper_sections").insert(rows).select("id, position");
  if (error) throwMapped(error);
  return [...data].sort((a, b) => a.position - b.position).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Paper header
// ---------------------------------------------------------------------------

export const createPaper = defineAction({
  name: "questionPapers.create",
  module: MODULE,
  schema: PaperCreateSchema,
  permission: "question.manage",
  handler: async (input, ctx) => {
    const db = await createClient();
    let blueprint = input.blueprint ?? null;
    let defaults: { exam_type: string | null; duration_minutes: number | null; instructions: string | null } = {
      exam_type: null,
      duration_minutes: null,
      instructions: null,
    };
    if (input.templateId) {
      const { data, error } = await db
        .from("question_paper_templates")
        .select("blueprint, exam_type, duration_minutes, instructions")
        .eq("id", input.templateId)
        .eq("institution_id", ctx.institution.id)
        .maybeSingle();
      if (error) throwMapped(error);
      if (!data) throw new AppError("not_found", "Template not found.");
      blueprint ??= data.blueprint as Blueprint;
      defaults = { exam_type: data.exam_type, duration_minutes: data.duration_minutes, instructions: data.instructions };
    }
    const { data, error } = await db
      .from("question_papers")
      .insert({
        institution_id: ctx.institution.id,
        academic_year_id: input.academicYearId,
        grade_id: input.gradeId,
        subject_id: input.subjectId,
        section_id: input.sectionId ?? null,
        exam_id: input.examId ?? null,
        exam_paper_id: input.examPaperId ?? null,
        template_id: input.templateId ?? null,
        title: input.title,
        exam_type: input.examType ?? defaults.exam_type,
        exam_date: input.examDate ?? null,
        duration_minutes: input.durationMinutes ?? defaults.duration_minutes,
        total_marks: input.totalMarks,
        pass_marks: input.passMarks,
        instructions: input.instructions ?? defaults.instructions,
        negative_marking: input.negativeMarking,
        blueprint: blueprint as Json,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    // 42501 here is the 0149 insert policy: a teacher outside their taught (grade, subject, year).
    if (error?.code === "42501") throw new AppError("forbidden", "You can set papers only for a subject you teach in this class and academic year.");
    if (error) throwMapped(error);
    const sectionIds = blueprint ? await sectionsFromBlueprint(db, ctx, data.id, blueprint, 0) : [];
    await audit(ctx, { action: "question_paper.create", entityType: "question_paper", entityId: data.id, after: { title: input.title } });
    /** sectionIds[i] is blueprint section i. */
    return { id: data.id, sectionIds };
  },
});

export const updatePaper = defineAction({
  name: "questionPapers.update",
  module: MODULE,
  schema: PaperUpdateSchema,
  permission: "question.manage",
  handler: async ({ id, ...p }, ctx) => {
    const db = await createClient();
    // undefined keys are dropped by supabase-js: only sent fields change.
    const { data, error } = await db
      .from("question_papers")
      .update({
        title: p.title,
        exam_type: p.examType,
        exam_date: p.examDate,
        duration_minutes: p.durationMinutes,
        total_marks: p.totalMarks,
        pass_marks: p.passMarks,
        instructions: p.instructions,
        negative_marking: p.negativeMarking,
        section_id: p.sectionId,
        exam_id: p.examId,
        exam_paper_id: p.examPaperId,
        blueprint: p.blueprint as Json | undefined,
      })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    requireRow(data, "Paper");
    await audit(ctx, { action: "question_paper.update", entityType: "question_paper", entityId: id });
    return { id };
  },
});

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const addSection = defineAction({
  name: "questionPapers.section.add",
  module: MODULE,
  schema: SectionAddSchema,
  permission: "question.manage",
  handler: async (input, ctx) => {
    const db = await createClient();
    await loadPaper(db, ctx, input.paperId);
    const { data, error } = await db
      .from("question_paper_sections")
      .insert({
        institution_id: ctx.institution.id,
        paper_id: input.paperId,
        title: input.title,
        instructions: input.instructions ?? null,
        choose_count: input.chooseCount ?? null,
        position: await nextPosition(db, "question_paper_sections", input.paperId),
      })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "question_paper.section.add", entityType: "question_paper", entityId: input.paperId, after: { sectionId: data.id } });
    return { id: data.id };
  },
});

export const updateSection = defineAction({
  name: "questionPapers.section.update",
  module: MODULE,
  schema: SectionUpdateSchema,
  permission: "question.manage",
  handler: async ({ id, ...p }, ctx) => {
    const db = await createClient();
    const { data, error } = await db
      .from("question_paper_sections")
      .update({ title: p.title, instructions: p.instructions, choose_count: p.chooseCount })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("paper_id")
      .maybeSingle();
    if (error) throwMapped(error);
    const row = requireRow(data, "Section");
    await audit(ctx, { action: "question_paper.section.update", entityType: "question_paper", entityId: row.paper_id, after: { sectionId: id } });
    return { id };
  },
});

export const removeSection = defineAction({
  name: "questionPapers.section.remove",
  module: MODULE,
  schema: ItemIdSchema,
  permission: "question.manage",
  handler: async ({ id }, ctx) => {
    const db = await createClient();
    const { data, error } = await db
      .from("question_paper_sections")
      .delete()
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("paper_id")
      .maybeSingle();
    if (error) throwMapped(error);
    const row = requireRow(data, "Section");
    await audit(ctx, { action: "question_paper.section.remove", entityType: "question_paper", entityId: row.paper_id, before: { sectionId: id } });
    return { id };
  },
});

export const reorderSections = defineAction({
  name: "questionPapers.section.reorder",
  module: MODULE,
  schema: ReorderSectionsSchema,
  permission: "question.manage",
  handler: async ({ paperId, sectionIds }, ctx) => {
    const db = await createClient();
    const { data, error } = await db.from("question_paper_sections").select("id").eq("paper_id", paperId).eq("institution_id", ctx.institution.id);
    if (error) throwMapped(error);
    const current = new Set(data.map((s) => s.id));
    if (current.size !== sectionIds.length || sectionIds.some((s) => !current.has(s))) {
      throw new AppError("validation_failed", "Send every section of the paper, each once.");
    }
    // shortcut: one UPDATE per section (a paper has a handful); not atomic, but a partial failure only misorders.
    for (const [position, id] of sectionIds.entries()) {
      const { error: e } = await db.from("question_paper_sections").update({ position }).eq("id", id).eq("paper_id", paperId);
      if (e) throwMapped(e);
    }
    await audit(ctx, { action: "question_paper.section.reorder", entityType: "question_paper", entityId: paperId });
    return { paperId };
  },
});

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const addItemsFromBank = defineAction({
  name: "questionPapers.item.addFromBank",
  module: MODULE,
  schema: AddItemsFromBankSchema,
  permission: "question.manage",
  handler: async ({ sectionId, questionIds }, ctx) => {
    const db = await createClient();
    const { section, paper } = await loadSection(db, ctx, sectionId);
    const [bank, used] = await Promise.all([
      db.from("question_bank").select(BANK_SNAPSHOT).in("id", questionIds).eq("institution_id", ctx.institution.id),
      db.from("question_paper_items").select("source_question_id").eq("paper_id", paper.id).not("source_question_id", "is", null),
    ]);
    if (bank.error) throwMapped(bank.error);
    if (used.error) throwMapped(used.error);
    const inPaper = new Set(used.data.map((u) => u.source_question_id));
    const byId = new Map(bank.data.map((q) => [q.id, q]));
    const usable = questionIds.flatMap((id) => {
      const q = byId.get(id);
      // Drafts are allowed in (AI suggestions waiting for review); validate_paper blocks approval until they are approved.
      return q && !inPaper.has(id) && q.grade_id === paper.grade_id && q.subject_id === paper.subject_id && !["archived", "rejected"].includes(q.status)
        ? [q]
        : [];
    });
    const skipped = questionIds.filter((id) => !usable.some((q) => q.id === id));
    if (!usable.length) return { itemIds: [] as string[], skipped };
    const start = await nextPosition(db, "question_paper_items", sectionId);
    const { data, error } = await db
      .from("question_paper_items")
      .insert(
        usable.map((q, i) => ({
          ...snapshotFromBank(q as BankRow),
          institution_id: ctx.institution.id,
          paper_id: paper.id,
          section_id: section.id,
          position: start + i,
        })),
      )
      .select("id");
    if (error) throwMapped(error);
    await audit(ctx, { action: "question_paper.item.add", entityType: "question_paper", entityId: paper.id, after: { questionIds: usable.map((q) => q.id) } });
    return { itemIds: data.map((r) => r.id), skipped };
  },
});

export const addManualItem = defineAction({
  name: "questionPapers.item.addManual",
  module: MODULE,
  schema: AddManualItemSchema,
  permission: "question.manage",
  handler: async ({ sectionId, item }, ctx) => {
    const db = await createClient();
    const { section, paper } = await loadSection(db, ctx, sectionId);
    const shape = manualShape(item, paper);
    const { data, error } = await db
      .from("question_paper_items")
      .insert({
        ...snapshotFromShape(shape),
        institution_id: ctx.institution.id,
        paper_id: paper.id,
        section_id: section.id,
        position: await nextPosition(db, "question_paper_items", sectionId),
      })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "question_paper.item.add", entityType: "question_paper", entityId: paper.id, after: { itemId: data.id, manual: true } });
    return { id: data.id };
  },
});

export const updateItem = defineAction({
  name: "questionPapers.item.update",
  module: MODULE,
  schema: UpdateItemSchema,
  permission: "question.manage",
  handler: async ({ id, item }, ctx) => {
    const db = await createClient();
    const { paper } = await loadItem(db, ctx, id);
    const shape = manualShape(item, paper);
    // Edited text is no longer the bank question; the child guard keeps the item's origin (an edited AI draft stays AI).
    const { data, error } = await db
      .from("question_paper_items")
      .update({ ...snapshotFromShape(shape), source_question_id: null })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    requireRow(data, "Question");
    await audit(ctx, { action: "question_paper.item.update", entityType: "question_paper", entityId: paper.id, after: { itemId: id } });
    return { id };
  },
});

export const removeItem = defineAction({
  name: "questionPapers.item.remove",
  module: MODULE,
  schema: ItemIdSchema,
  permission: "question.manage",
  handler: async ({ id }, ctx) => {
    const db = await createClient();
    const { data, error } = await db
      .from("question_paper_items")
      .delete()
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("paper_id")
      .maybeSingle();
    if (error) throwMapped(error);
    const row = requireRow(data, "Question");
    await audit(ctx, { action: "question_paper.item.remove", entityType: "question_paper", entityId: row.paper_id, before: { itemId: id } });
    return { id };
  },
});

export const reorderItems = defineAction({
  name: "questionPapers.item.reorder",
  module: MODULE,
  schema: ReorderItemsSchema,
  permission: "question.manage",
  handler: async ({ sectionId, itemIds }, ctx) => {
    const db = await createClient();
    const { paper } = await loadSection(db, ctx, sectionId);
    const { data, error } = await db.from("question_paper_items").select("id, section_id").in("id", itemIds).eq("paper_id", paper.id);
    if (error) throwMapped(error);
    if (data.length !== new Set(itemIds).size || data.length !== itemIds.length) {
      throw new AppError("validation_failed", "Every question must belong to this paper, each once.");
    }
    const fromSection = new Map(data.map((r) => [r.id, r.section_id]));
    // shortcut: one UPDATE per item (papers hold tens of items); not atomic, a partial failure only misorders.
    for (const [position, id] of itemIds.entries()) {
      const moved = fromSection.get(id) !== sectionId;
      // A choice group is per section: a moved item leaves its OR pair.
      const patch = moved ? { position, section_id: sectionId, choice_group: null } : { position };
      const { error: e } = await db.from("question_paper_items").update(patch).eq("id", id).eq("paper_id", paper.id);
      if (e) throwMapped(e);
    }
    await audit(ctx, { action: "question_paper.item.reorder", entityType: "question_paper", entityId: paper.id, after: { sectionId } });
    return { sectionId };
  },
});

export const setChoiceGroup = defineAction({
  name: "questionPapers.item.setChoiceGroup",
  module: MODULE,
  schema: SetChoiceGroupSchema,
  permission: "question.manage",
  handler: async ({ itemIds, choiceGroup }, ctx) => {
    const db = await createClient();
    const { data, error } = await db
      .from("question_paper_items")
      .select("id, paper_id, section_id")
      .in("id", itemIds)
      .eq("institution_id", ctx.institution.id);
    if (error) throwMapped(error);
    if (data.length !== itemIds.length) throw new AppError("not_found", "Question not found in this paper.");
    if (new Set(data.map((r) => r.section_id)).size !== 1) {
      throw new AppError("validation_failed", "OR choices must sit in the same section.");
    }
    const { error: e, data: updated } = await db
      .from("question_paper_items")
      .update({ choice_group: choiceGroup })
      .in("id", itemIds)
      .eq("institution_id", ctx.institution.id)
      .select("id");
    if (e) throwMapped(e);
    if (updated.length !== itemIds.length) throw new AppError("not_found", "Question not found, or you cannot change it.");
    await audit(ctx, { action: "question_paper.item.choice", entityType: "question_paper", entityId: data[0].paper_id, after: { itemIds, choiceGroup } });
    return { itemIds, choiceGroup };
  },
});

export const replaceItem = defineAction({
  name: "questionPapers.item.replace",
  module: MODULE,
  schema: ReplaceItemSchema,
  permission: "question.manage",
  handler: async ({ id, questionId }, ctx) => {
    const db = await createClient();
    const { paper } = await loadItem(db, ctx, id);
    const { data: q, error } = await db
      .from("question_bank")
      .select(BANK_SNAPSHOT)
      .eq("id", questionId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (error) throwMapped(error);
    if (!q || q.grade_id !== paper.grade_id || q.subject_id !== paper.subject_id || ["archived", "rejected"].includes(q.status)) {
      throw new AppError("not_found", "Question not found for this class and subject.");
    }
    const { data, error: e } = await db
      .from("question_paper_items")
      .update(snapshotFromBank(q as BankRow))
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (e) throwMapped(e);
    requireRow(data, "Question");
    await audit(ctx, { action: "question_paper.item.replace", entityType: "question_paper", entityId: paper.id, after: { itemId: id, questionId } });
    return { id };
  },
});

// ---------------------------------------------------------------------------
// Templates and generation
// ---------------------------------------------------------------------------

export const saveTemplate = defineAction({
  name: "questionPapers.template.save",
  module: MODULE,
  schema: TemplateSaveSchema,
  permission: "question.manage",
  handler: async ({ id, ...t }, ctx) => {
    const db = await createClient();
    const columns = {
      name: t.name,
      grade_id: t.gradeId ?? null,
      subject_id: t.subjectId ?? null,
      exam_type: t.examType ?? null,
      duration_minutes: t.durationMinutes ?? null,
      instructions: t.instructions ?? null,
      blueprint: t.blueprint as NonNullable<Json>,
    };
    const { data, error } = id
      ? await db.from("question_paper_templates").update(columns).eq("id", id).eq("institution_id", ctx.institution.id).select("id").maybeSingle()
      : await db
          .from("question_paper_templates")
          .insert({ ...columns, institution_id: ctx.institution.id, created_by: ctx.user.id })
          .select("id")
          .single();
    if (error) throwMapped(error);
    const row = requireRow(data, "Template");
    await audit(ctx, { action: id ? "question_paper.template.update" : "question_paper.template.create", entityType: "question_paper_template", entityId: row.id });
    return { id: row.id };
  },
});

export const applyTemplate = defineAction({
  name: "questionPapers.template.apply",
  module: MODULE,
  schema: ApplyTemplateSchema,
  permission: "question.manage",
  handler: async ({ paperId, templateId }, ctx) => {
    const db = await createClient();
    const { data: t, error } = await db
      .from("question_paper_templates")
      .select("blueprint")
      .eq("id", templateId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (error) throwMapped(error);
    if (!t) throw new AppError("not_found", "Template not found.");
    const { data, error: e } = await db
      .from("question_papers")
      .update({ blueprint: t.blueprint, template_id: templateId })
      .eq("id", paperId)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (e) throwMapped(e);
    requireRow(data, "Paper");
    // Adds only the blueprint sections the paper does not have yet (matched by title).
    const { data: have, error: ce } = await db.from("question_paper_sections").select("id, title").eq("paper_id", paperId).order("position").order("id");
    if (ce) throwMapped(ce);
    const bp = t.blueprint as Blueprint;
    const mapped = mapSectionsByTitle(bp, have);
    await sectionsFromBlueprint(db, ctx, paperId, { ...bp, sections: bp.sections.filter((_, i) => !mapped[i]) }, await nextPosition(db, "question_paper_sections", paperId));
    await audit(ctx, { action: "question_paper.template.apply", entityType: "question_paper", entityId: paperId, after: { templateId } });
    return { paperId };
  },
});

export interface GenerationGap {
  /** null: no paper section has this blueprint section's title, so nothing was filled for it. */
  sectionId: string | null;
  sectionTitle: string;
  type: string;
  marks: number;
  difficulty: string | null;
  missing: number;
}

/**
 * Fills the blueprint from APPROVED bank questions only, deterministically
 * (seeded by paper id), and returns what the bank could not supply. The UI
 * may fill gaps with /api/ai/questions-generate: those save as draft bank
 * questions, added here by id, and block approval until the bank approves them.
 */
export const generatePaperFromTemplate = defineAction({
  name: "questionPapers.generate",
  module: MODULE,
  schema: PaperIdSchema,
  permission: "question.manage",
  handler: async ({ id }, ctx) => {
    const db = await createClient();
    const paper = await loadPaper(db, ctx, id);
    const blueprint = paper.blueprint as Blueprint | null;
    if (!blueprint) throw new AppError("invalid_state", "Apply a template or blueprint to this paper first.");
    if (!["draft", "in_review"].includes(paper.status)) throw new AppError("invalid_state", "Only a draft paper can be filled.");

    const { count, error: ce } = await db.from("question_paper_sections").select("id", { count: "exact", head: true }).eq("paper_id", id);
    if (ce) throwMapped(ce);
    // A paper with no sections gets the blueprint's; otherwise sections are matched by title and never created here.
    if (!count) await sectionsFromBlueprint(db, ctx, id, blueprint, 0);
    const [sectionsRes, itemsRes] = await Promise.all([
      db.from("question_paper_sections").select("id, title").eq("paper_id", id).order("position").order("id"),
      db.from("question_paper_items").select("id, section_id, type, marks, choice_group, source_question_id, position").eq("paper_id", id).order("position").order("id"),
    ]);
    if (sectionsRes.error) throwMapped(sectionsRes.error);
    if (itemsRes.error) throwMapped(itemsRes.error);
    const used = new Set(itemsRes.data.map((i) => i.source_question_id).filter(Boolean));

    const gaps: GenerationGap[] = [];
    const added: string[] = [];
    const mapped = mapSectionsByTitle(blueprint, sectionsRes.data);
    for (const [si, bpSection] of blueprint.sections.entries()) {
      const section = mapped[si];
      if (!section) {
        for (const row of bpSection.rows) {
          gaps.push({ sectionId: null, sectionTitle: bpSection.title, type: row.type, marks: row.marks, difficulty: row.difficulty ?? null, missing: row.count });
        }
        continue;
      }
      const existing = slots(
        itemsRes.data.filter((i) => i.section_id === section.id).map((i) => ({ ...i, marks: Number(i.marks), choiceGroup: i.choice_group })),
      ).map((slot) => slot[0]);
      let position = existing.length ? Math.max(...itemsRes.data.filter((i) => i.section_id === section.id).map((i) => i.position)) + 1 : 0;
      for (const [ri, row] of bpSection.rows.entries()) {
        const need = row.count - existing.filter((i) => i.type === row.type && i.marks === row.marks).length;
        if (need <= 0) continue;
        let query = db
          .from("question_bank")
          .select(BANK_SNAPSHOT)
          .eq("institution_id", ctx.institution.id)
          .eq("grade_id", paper.grade_id)
          .eq("subject_id", paper.subject_id)
          .eq("status", "approved")
          .eq("type", row.type)
          .eq("marks", row.marks);
        if (row.difficulty) query = query.eq("difficulty", row.difficulty);
        const { data: pool, error } = await query.order("id").limit(500);
        if (error) throwMapped(error);
        const picks = seededShuffle(
          pool.filter((q) => !used.has(q.id)),
          `${id}:${si}:${ri}`,
        ).slice(0, need);
        if (picks.length) {
          const { data: inserted, error: ie } = await db
            .from("question_paper_items")
            .insert(
              picks.map((q) => ({
                ...snapshotFromBank(q as BankRow),
                institution_id: ctx.institution.id,
                paper_id: id,
                section_id: section.id,
                position: position++,
              })),
            )
            .select("id");
          if (ie) throwMapped(ie);
          added.push(...inserted.map((r) => r.id));
          for (const q of picks) used.add(q.id);
        }
        if (picks.length < need) {
          gaps.push({ sectionId: section.id, sectionTitle: section.title, type: row.type, marks: row.marks, difficulty: row.difficulty ?? null, missing: need - picks.length });
        }
      }
    }
    await audit(ctx, { action: "question_paper.generate", entityType: "question_paper", entityId: id, after: { added: added.length, gaps: gaps.length } });
    return { addedItemIds: added, gaps };
  },
});

// ---------------------------------------------------------------------------
// Status (public.transition_question_paper is the only writer of status)
// ---------------------------------------------------------------------------

async function transition(ctx: TenantContext, id: string, to: PaperStatus, reason: string | undefined, expectedUpdatedAt?: string) {
  const db = await createClient();
  await loadPaper(db, ctx, id);
  const { data, error } = await db.rpc("transition_question_paper", {
    p_paper_id: id,
    p_to: to,
    p_reason: reason,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throwMapped(error);
  const result = data as { status: PaperStatus; version: number; examPaperId: string | null };
  await audit(ctx, { action: `question_paper.${to}`, entityType: "question_paper", entityId: id, after: { status: to, version: result.version, reason } });
  return { id, status: result.status, version: result.version, examPaperId: result.examPaperId };
}

export const submitPaperForReview = defineAction({
  name: "questionPapers.submitForReview",
  module: MODULE,
  schema: PaperTransitionSchema,
  permission: "question.manage",
  handler: ({ id, reason }, ctx) => transition(ctx, id, "in_review", reason),
});

export const returnPaperToDraft = defineAction({
  name: "questionPapers.returnToDraft",
  module: MODULE,
  schema: PaperTransitionSchema,
  permission: "question.manage",
  handler: ({ id, reason }, ctx) => transition(ctx, id, "draft", reason),
});

export const approvePaper = defineAction({
  name: "questionPapers.approve",
  module: MODULE,
  schema: ApprovePaperSchema,
  permission: "paper.approve",
  handler: ({ id, reason, expectedUpdatedAt }, ctx) => transition(ctx, id, "approved", reason, expectedUpdatedAt),
});

export const publishPaper = defineAction({
  name: "questionPapers.publish",
  module: MODULE,
  schema: PaperTransitionSchema,
  permission: "paper.publish",
  handler: ({ id, reason }, ctx) => transition(ctx, id, "published", reason),
});

export const archivePaper = defineAction({
  name: "questionPapers.archive",
  module: MODULE,
  schema: PaperTransitionSchema,
  permission: "question.manage",
  handler: ({ id, reason }, ctx) => transition(ctx, id, "archived", reason),
});

async function copy(ctx: TenantContext, id: string, asRevision: boolean) {
  const db = await createClient();
  await loadPaper(db, ctx, id);
  const { data, error } = await db.rpc("copy_question_paper", { p_paper_id: id, p_as_revision: asRevision });
  if (error) throwMapped(error);
  const newId = data as string;
  await audit(ctx, {
    action: asRevision ? "question_paper.revision" : "question_paper.duplicate",
    entityType: "question_paper",
    entityId: newId,
    after: { from: id },
  });
  return { id: newId };
}

export const newPaperRevision = defineAction({
  name: "questionPapers.newRevision",
  module: MODULE,
  schema: PaperIdSchema,
  permission: "question.manage",
  handler: ({ id }, ctx) => copy(ctx, id, true),
});

export const duplicatePaper = defineAction({
  name: "questionPapers.duplicate",
  module: MODULE,
  schema: PaperIdSchema,
  permission: "question.manage",
  handler: ({ id }, ctx) => copy(ctx, id, false),
});
