"use server";

// 0146 — CSV import/export for the question bank. Reuses the imports
// module's parseCsv (size/row caps, trimming) but not its stage/commit
// batches: those are built for student/staff records. Import is
// all-or-nothing: every row is checked with the same Zod union as
// questionBank.create, and nothing is saved if any row fails. Imported rows
// are origin `import`, status `draft` (they need review). Near-duplicates are
// warnings, never a block. RLS scopes both directions (a teacher imports and
// exports only their taught grade+subject pairs).
//
// Columns: type, difficulty, body, answer, marks, options, explanation,
// marking_scheme, learning_outcome, unit_sequence, tolerance. Lists
// (options; answers of multi_select / fill_blank) are `|`-separated.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { Json } from "@/lib/db/types";
import { rowsToCsvText, unescapeFormula } from "@/lib/http/csv-text";
import { createClient } from "@/lib/supabase/server";
import { parseCsv } from "@/modules/imports/schemas";
import { findNearDuplicates } from "@/modules/question-bank/queries";
import {
  QuestionCreateSchema,
  QuestionExportSchema,
  QuestionImportSchema,
  csvRowToQuestionInput,
  questionShapeColumns,
  type QuestionExportInput,
  type QuestionImportInput,
} from "@/modules/question-bank/schemas";

const MAX_IMPORT_ROWS = 500;
const MAX_EXPORT_ROWS = 5000;
const CSV_COLUMNS = [
  "type",
  "difficulty",
  "body",
  "answer",
  "marks",
  "options",
  "explanation",
  "marking_scheme",
  "learning_outcome",
  "unit_sequence",
  "tolerance",
] as const;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const importQuestions = defineAction({
  name: "questionBank.import",
  module: "question_bank",
  schema: QuestionImportSchema,
  permission: "question.manage",
  handler: async ({ gradeId, subjectId, csv }: QuestionImportInput, ctx) => {
    const { rows } = parseCsv(csv);
    if (rows.length > MAX_IMPORT_ROWS) throw new AppError("validation_failed", `Import at most ${MAX_IMPORT_ROWS} questions at a time.`);

    const supabase = await createClient();
    const { data: units, error: unitError } = await supabase
      .from("curriculum_units")
      .select("id, sequence")
      .eq("institution_id", ctx.institution.id)
      .eq("grade_id", gradeId)
      .eq("subject_id", subjectId);
    if (unitError) throwMapped(unitError);
    const unitBySequence = new Map((units ?? []).map((u) => [String(u.sequence), u.id]));

    const fieldErrors: Record<string, string[]> = {};
    const inputs = rows.flatMap((raw, i) => {
      // Undo export's formula escaping (rowsToCsvText) so export -> import round-trips.
      const row = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, unescapeFormula(v)]));
      const line = `row ${i + 2}`; // header is line 1
      const unitId = row.unit_sequence ? unitBySequence.get(row.unit_sequence) : undefined;
      if (row.unit_sequence && !unitId) {
        fieldErrors[line] = [`No unit with sequence ${row.unit_sequence} in this grade and subject.`];
        return [];
      }
      const parsed = QuestionCreateSchema.safeParse(csvRowToQuestionInput(row, gradeId, subjectId, unitId));
      if (!parsed.success) {
        fieldErrors[line] = parsed.error.issues.map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`);
        return [];
      }
      return [parsed.data];
    });
    if (Object.keys(fieldErrors).length > 0) {
      throw new AppError("validation_failed", "Some rows are not valid. Nothing was imported.", fieldErrors);
    }

    // Before the insert, so the new rows do not match themselves.
    const warnings = await findNearDuplicates(ctx, gradeId, subjectId, inputs.map((q) => q.body));

    const { data, error } = await supabase
      .from("question_bank")
      .insert(
        inputs.map((q) => {
          const shape = questionShapeColumns(q);
          return {
            institution_id: ctx.institution.id,
            created_by: ctx.user.id,
            subject_id: subjectId,
            grade_id: gradeId,
            curriculum_unit_id: q.curriculumUnitId ?? null,
            type: q.type,
            difficulty: q.difficulty,
            body: q.body,
            marks: q.marks,
            options: shape.options as Json,
            answer_key: shape.answer_key as Json,
            answer: shape.answer,
            explanation: q.explanation ?? null,
            marking_scheme: q.markingScheme ?? null,
            learning_outcome: q.learningOutcome ?? null,
            origin: "import",
            status: "draft",
          };
        }),
      )
      .select("id");
    if (error) {
      if ((error as { code?: string }).code === "42501") throw new AppError("forbidden", "Outside your teaching scope.");
      throwMapped(error);
    }

    await audit(ctx, { action: "question_bank.import", entityType: "question_bank", metadata: { count: data.length, gradeId, subjectId } });
    return { inserted: data.length, ids: data.map((r) => r.id as string), warnings };
  },
});

function exportCell(value: Json): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("|");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export const exportQuestions = defineAction({
  name: "questionBank.export",
  module: "question_bank",
  schema: QuestionExportSchema,
  permission: "question.manage",
  handler: async ({ gradeId, subjectId, curriculumUnitId, status }: QuestionExportInput, ctx) => {
    const supabase = await createClient();
    let query = supabase
      .from("question_bank")
      .select("type, difficulty, body, answer, answer_key, marks, options, explanation, marking_scheme, learning_outcome, curriculum_units(sequence)")
      .eq("institution_id", ctx.institution.id)
      .eq("status", status)
      .order("created_at")
      .limit(MAX_EXPORT_ROWS);
    if (gradeId) query = query.eq("grade_id", gradeId);
    if (subjectId) query = query.eq("subject_id", subjectId);
    if (curriculumUnitId) query = query.eq("curriculum_unit_id", curriculumUnitId);
    const { data, error } = await query;
    if (error) throwMapped(error);

    const rows = data.map((q) => {
      const key = q.answer_key as { value?: number; tolerance?: number } | string[] | null;
      const keyed = q.type === "multi_select" || q.type === "fill_blank";
      return {
        type: q.type,
        difficulty: q.difficulty,
        body: q.body,
        answer: keyed ? exportCell(key as Json) : q.type === "numerical" && key && !Array.isArray(key) ? String(key.value) : q.answer,
        marks: String(q.marks),
        options: exportCell(q.options),
        explanation: q.explanation ?? "",
        marking_scheme: q.marking_scheme ?? "",
        learning_outcome: q.learning_outcome ?? "",
        unit_sequence: q.curriculum_units ? String(q.curriculum_units.sequence) : "",
        tolerance: q.type === "numerical" && key && !Array.isArray(key) && key.tolerance ? String(key.tolerance) : "",
      };
    });
    // Formula-escaped (= + - @ prefixed with '): bodies are free text from many authors.
    const csv = rowsToCsvText(rows, CSV_COLUMNS);

    await audit(ctx, { action: "question_bank.export", entityType: "question_bank", metadata: { count: rows.length, status } });
    return { csv, count: rows.length, truncated: rows.length === MAX_EXPORT_ROWS };
  },
});
