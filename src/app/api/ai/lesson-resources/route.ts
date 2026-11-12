import "server-only";
// Resources for a lesson plan: the school's own (Resources page) or the web (Google-grounded). Nothing is saved here.
import { findLessonResources } from "@/modules/ai/explain/generate";
import { explainRoute } from "@/modules/ai/explain/route";
import { LessonResourcesRequestSchema } from "@/modules/ai/explain/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = explainRoute({ route: "lesson-resources", schema: LessonResourcesRequestSchema, maxBodyBytes: 4 * 1024, run: findLessonResources });
