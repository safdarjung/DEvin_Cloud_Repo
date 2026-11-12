import "server-only";
// /lessonplan: a full timed lesson plan from the teacher's own words (chapter, class, length). Draft only:
// the teacher saves it through the lesson-plan approval card, which re-checks the section and subject.
import { makeLessonPlan } from "@/modules/ai/explain/generate";
import { explainRoute } from "@/modules/ai/explain/route";
import { LessonPlanRequestSchema } from "@/modules/ai/explain/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const POST = explainRoute({ route: "lessonplan", schema: LessonPlanRequestSchema, maxBodyBytes: 4 * 1024, run: makeLessonPlan });
