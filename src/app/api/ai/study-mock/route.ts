import "server-only";
// Study help (0140, student): a timed mock exam paper for a real upcoming exam
// paper of the student's own section, or a subject + chosen units. Practice
// only. Draft: the student keeps it with study.mock.save or discards it.
import { aiTaskRoute } from "@/modules/ai/task-route";
import { generateMock } from "@/modules/study/mock-generate";
import { MockRequestSchema } from "@/modules/study/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = aiTaskRoute({
  route: "study-mock",
  schema: MockRequestSchema,
  maxBodyBytes: 8 * 1024,
  permission: "ai.study",
  capability: "study_studio",
  module: "ai_student",
  run: (ctx, input) => generateMock(ctx, input),
});
