import "server-only";
// Study studio (teacher): any summary format, a flashcard deck or a quiz from
// a curriculum unit, a lesson plan, a resource or pasted material. Draft only:
// the teacher reviews/edits it and shares it with study.teacher.material.save.
import { aiTaskRoute } from "@/modules/ai/task-route";
import { generateStudy } from "@/modules/study/generate";
import { TeacherStudyGenerateRequestSchema } from "@/modules/study/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = aiTaskRoute({
  route: "study-teacher-generate",
  schema: TeacherStudyGenerateRequestSchema,
  maxBodyBytes: 48 * 1024,
  permission: "ai.generate",
  capability: "teacher_study_studio",
  run: (ctx, input) => generateStudy(ctx, input, "teacher"),
});
