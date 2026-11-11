import "server-only";
// 0140 mock exam (student, practice only): a real upcoming exam paper of the
// student's own section (my_exam_paper_scope: subject, units, duration) or a
// subject + chosen units of their own subjects. Unit titles/outlines come
// from the DB; the gateway call is the same redacted cloud path as the studio.
// Persists nothing: the student keeps the paper with study.mock.save.
import { AppError, fail, ok, type ActionResult } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { buildMockPrompt, mockInstructions } from "@/modules/ai/prompts/study";
import type { MockContent } from "@/modules/study/formats";
import { studentUnits } from "@/modules/study/help-sources";
import { MOCK_MAX_UNITS, MockGenerationSchema, assembleMock, sectionPlan } from "@/modules/study/mock";
import type { MockRequest } from "@/modules/study/schemas";

const MAX_OUTPUT_TOKENS = 4096;

export interface MockDraft {
  title: string;
  subjectId: string | null;
  content: MockContent;
  focusUnitIds: string[];
  provider: "local" | "cloud";
  model: string;
}

export async function generateMock(ctx: TenantContext, input: Omit<MockRequest, "institutionSlug">): Promise<ActionResult<MockDraft>> {
  if (!ctx.membership.studentId) return fail("forbidden", "Mock exams are for students.");
  const supabase = await createClient();
  const { units: allowed } = await studentUnits(supabase, ctx);

  let subjectId: string;
  let units: typeof allowed;
  let durationMinutes: number;
  let examLabel: string | null = null;
  let paperId: string | null = null;
  if (input.scope.kind === "paper") {
    const { data, error } = await supabase.rpc("my_exam_paper_scope", { p_paper_id: input.scope.paperId });
    if (error) throw error;
    const paper = (data ?? [])[0];
    if (!paper) throw new AppError("not_found", "That exam paper was not found.");
    subjectId = paper.subject_id;
    const ofSubject = allowed.filter((u) => u.subjectId === subjectId);
    const mapped = ofSubject.filter((u) => (paper.unit_ids ?? []).includes(u.id));
    // A paper without mapped units covers the subject's units in order (capped).
    units = (mapped.length ? mapped : ofSubject).slice(0, MOCK_MAX_UNITS);
    durationMinutes = Math.min(180, Math.max(5, paper.duration_minutes ?? 60));
    examLabel = `${paper.exam_name} — ${paper.subject_name}`.slice(0, 160);
    paperId = paper.paper_id;
  } else {
    subjectId = input.scope.subjectId;
    const wanted = new Set(input.scope.unitIds);
    units = allowed.filter((u) => u.subjectId === subjectId && wanted.has(u.id));
    if (units.length !== wanted.size) throw new AppError("not_found", "Pick units from your own subjects.");
    durationMinutes = input.scope.durationMinutes;
  }
  if (units.length === 0) throw new AppError("validation_failed", "This subject has no curriculum units yet, so a mock exam cannot be made.");

  const plan = sectionPlan(input.count);
  const generated = await runStructured({
    ctx,
    feature: "study_mock",
    permission: "ai.study",
    agentCloud: true, // owner cloud exception (D28 ext.): unit titles/outlines only, redacted
    schema: MockGenerationSchema,
    instructions: mockInstructions(),
    prompt: buildMockPrompt({ subjectName: units[0]!.subjectName, examLabel, difficulty: input.difficulty, plan, units }),
    denyNames: ctx.user.profile.fullName ? [ctx.user.profile.fullName] : [],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  if (!generated.ok) return generated;

  const assembled = assembleMock(generated.data.data, { units, count: input.count, difficulty: input.difficulty, durationMinutes, examLabel, paperId });
  if (!assembled.ok) return fail("ai_invalid_output", "The AI paper did not fit the mock exam format. Try again.");
  return ok({
    title: `Mock exam: ${examLabel ?? units[0]!.subjectName}`.slice(0, 160),
    subjectId,
    content: assembled.content,
    focusUnitIds: units.map((u) => u.id),
    provider: generated.data.provider,
    model: generated.data.model,
  });
}
