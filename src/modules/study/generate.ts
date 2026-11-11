import "server-only";
// Study studio generation, shared by the student and teacher routes. Reads
// the source under the caller's RLS, calls the one gateway (runStructured:
// permission, quota, rate, usage log, cloud redaction) with the format's
// strict schema, and validates the result whole. Persists nothing (rule 6):
// the person keeps the draft with a save action, or discards it.
import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import { buildStudyPrompt, studyInstructions } from "@/modules/ai/prompts/study";
import { FORMAT_LABELS, generationSchema, toStoredContent, type StudyFormat } from "@/modules/study/formats";
import type { StudyGenerateRequest } from "@/modules/study/schemas";
import { resolveStudySource } from "@/modules/study/sources";

// Largest format (40 flashcards / 15 quiz questions with explanations) fits well under this (lesson 9: always cap output).
const MAX_OUTPUT_TOKENS = 4096;

export interface GeneratedStudy {
  format: StudyFormat;
  title: string;
  sourceKind: StudyGenerateRequest["source"]["kind"];
  subjectId: string | null;
  unitId: string | null;
  resourceId: string | null;
  content: unknown;
  provider: "local" | "cloud";
  model: string;
}

export async function generateStudy(
  ctx: TenantContext,
  input: Omit<StudyGenerateRequest, "institutionSlug">,
  audience: "student" | "teacher",
): Promise<ActionResult<GeneratedStudy>> {
  if (input.format === "quiz" && !input.quiz) return fail("validation_failed", "Choose the quiz length, difficulty and question types.");
  const source = await resolveStudySource(ctx, input.source, audience);
  const quiz = input.format === "quiz" ? input.quiz : undefined;

  const generated = await runStructured({
    ctx,
    feature: audience === "student" ? "study_material" : "teacher_study_material",
    // Owner cloud exception (D28 ext. 2026-11-06): the prompt is the source text only, redacted on the cloud path.
    agentCloud: true,
    permission: audience === "student" ? "ai.study" : "ai.generate",
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
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  if (!generated.ok) return generated;

  const stored = toStoredContent(input.format, generated.data.data, { quizTypes: quiz?.types, quizCount: quiz?.count, difficulty: quiz?.difficulty });
  if (!stored.ok) return fail("ai_invalid_output", "The AI draft did not fit this format. Try again.");

  return ok({
    format: input.format,
    title: `${FORMAT_LABELS[input.format]}: ${source.title}`.slice(0, 160),
    sourceKind: input.source.kind,
    subjectId: source.subjectId,
    unitId: source.unitId,
    resourceId: source.resourceId,
    content: stored.content,
    provider: generated.data.provider,
    model: generated.data.model,
  });
}
