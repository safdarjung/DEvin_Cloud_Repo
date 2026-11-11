import "server-only";
// Study studio generation, shared by the student and teacher routes. Reads
// the source under the caller's RLS, calls the one gateway (runStructured:
// permission, quota, rate, usage log, cloud redaction) with the format's
// strict schema, and validates the result whole. Persists nothing (rule 6):
// the person keeps the draft with a save action, or discards it.
// 0140: a file source goes through runStructuredFile (Gemini reads the PDF or
// image) only behind the route's study capability, the role's cloud switch
// (gateway) and the person's "my file is sent to the school's AI provider" consent.
import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { runStructured, runStructuredFile } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { buildStudyPrompt, studyInstructions } from "@/modules/ai/prompts/study";
import { FORMAT_LABELS, generationSchema, toStoredContent, type GeneratedFormat } from "@/modules/study/formats";
import type { StudyGenerateRequest } from "@/modules/study/schemas";
import { resolveStudySource } from "@/modules/study/sources";

// Largest format (40 flashcards / 15 quiz questions with explanations) fits well under this (lesson 9: always cap output).
const MAX_OUTPUT_TOKENS = 4096;
// Three worksheet levels with an answer key each.
const WORKSHEET_OUTPUT_TOKENS = 6144;

export type StoredSourceKind = "unit" | "paste" | "resource" | "lesson_plan" | "textbook" | "file" | "revision_pack" | "class_pack" | "scope";

export interface GeneratedStudy {
  format: GeneratedFormat;
  title: string;
  sourceKind: StoredSourceKind;
  subjectId: string | null;
  unitId: string | null;
  resourceId: string | null;
  sourceMaterialId: string | null;
  focusUnitIds: string[];
  content: unknown;
  provider: "local" | "cloud";
  model: string;
}

const STORED_KIND: Record<StudyGenerateRequest["source"]["kind"], StoredSourceKind> = {
  unit: "unit",
  paste: "paste",
  resource: "resource",
  lesson_plan: "lesson_plan",
  textbook: "textbook",
  file: "file",
  weak_units: "revision_pack",
  class_weak_units: "class_pack",
  scope: "scope",
  units: "scope",
};

export async function hasFileReadingConsent(ctx: TenantContext): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_ai_consents")
    .select("kind")
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", ctx.user.id)
    .eq("kind", "file_reading")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function generateStudy(
  ctx: TenantContext,
  input: Omit<StudyGenerateRequest, "institutionSlug">,
  audience: "student" | "teacher",
): Promise<ActionResult<GeneratedStudy>> {
  if (input.format === "quiz" && !input.quiz) return fail("validation_failed", "Choose the quiz length, difficulty and question types.");
  if (input.format === "worksheet" && audience !== "teacher") return fail("forbidden", "Worksheets are made by teachers.");
  if (input.source.kind === "file") {
    if (!(await hasFileReadingConsent(ctx))) {
      return fail("validation_failed", "Tick the box to agree that your file is sent to the school's AI provider to be read.", { consent: ["Required the first time"] });
    }
  }
  const source = await resolveStudySource(ctx, input.source, audience);
  const quiz = input.format === "quiz" ? input.quiz : undefined;

  const call = {
    ctx,
    feature: audience === "student" ? "study_material" : "teacher_study_material",
    permission: audience === "student" ? ("ai.study" as const) : ("ai.generate" as const),
    schema: generationSchema(input.format),
    instructions: studyInstructions(audience, input.format),
    prompt: buildStudyPrompt({
      format: input.format,
      gradeLabel: source.gradeLabel,
      subjectName: source.subjectName,
      sourceLabel: source.sourceLabel,
      sourceLines: source.lines,
      quiz: quiz ? { count: quiz.count, difficulty: quiz.difficulty, types: quiz.types } : undefined,
    }),
    denyNames: ctx.user.profile.fullName ? [ctx.user.profile.fullName] : [],
    maxOutputTokens: input.format === "worksheet" ? WORKSHEET_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS,
  };
  const generated = source.file
    ? await runStructuredFile({ ...call, file: source.file })
    : // Owner cloud exception (D28 ext. 2026-11-06): the prompt is the source text only, redacted on the cloud path.
      await runStructured({ ...call, agentCloud: true });
  if (!generated.ok) return generated;

  const stored = toStoredContent(input.format, generated.data.data, { quizTypes: quiz?.types, quizCount: quiz?.count, difficulty: quiz?.difficulty });
  if (!stored.ok) return fail("ai_invalid_output", "The AI draft did not fit this format. Try again.");

  return ok({
    format: input.format,
    title: `${FORMAT_LABELS[input.format]}: ${source.title}`.slice(0, 160),
    sourceKind: STORED_KIND[input.source.kind],
    subjectId: source.subjectId,
    unitId: source.unitId,
    resourceId: source.resourceId,
    sourceMaterialId: source.sourceMaterialId ?? null,
    focusUnitIds: source.focusUnitIds ?? [],
    content: stored.content,
    provider: generated.data.provider,
    model: generated.data.model,
  });
}
