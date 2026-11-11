import "server-only";
// Study studio (student): one summary format, a flashcard deck or a quiz from
// a curriculum unit of the student's own subjects, a resource shared with
// their section, or pasted notes (capped at PASTE_MAX_CHARS). Draft only: the
// student keeps it with study.material.save or discards it.
import { aiTaskRoute } from "@/modules/ai/task-route";
import { generateStudy } from "@/modules/study/generate";
import { StudyGenerateRequestSchema } from "@/modules/study/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = aiTaskRoute({
  route: "study-generate",
  schema: StudyGenerateRequestSchema,
  // 12,000 pasted characters, up to 3 bytes each in UTF-8.
  maxBodyBytes: 48 * 1024,
  permission: "ai.study",
  capability: "study_studio",
  module: "ai_student",
  run: (ctx, input) => generateStudy(ctx, input, "student"),
});
