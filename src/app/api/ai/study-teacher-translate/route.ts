import "server-only";
// Study help (0140, teacher): a Hindi (or English) version of the teacher's own
// study material or worksheet, keeping its structure. Draft only: kept with
// study.teacher.material.saveVariant, shown as an AI translation.
import { aiTaskRoute } from "@/modules/ai/task-route";
import { TranslateMaterialRequestSchema } from "@/modules/study/schemas";
import { translateMaterial } from "@/modules/study/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = aiTaskRoute({
  route: "study-teacher-translate",
  schema: TranslateMaterialRequestSchema,
  maxBodyBytes: 4 * 1024,
  permission: "ai.generate",
  capability: "teacher_study_studio",
  run: (ctx, input) => translateMaterial(ctx, input, "teacher"),
});
