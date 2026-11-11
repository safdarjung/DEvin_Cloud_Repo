import "server-only";
// Study help (0140, student): a Hindi (or English) version of a study material
// the student can read, keeping its structure. Draft only: kept with
// study.material.saveVariant, shown as an AI translation.
import { aiTaskRoute } from "@/modules/ai/task-route";
import { TranslateMaterialRequestSchema } from "@/modules/study/schemas";
import { translateMaterial } from "@/modules/study/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = aiTaskRoute({
  route: "study-translate",
  schema: TranslateMaterialRequestSchema,
  maxBodyBytes: 4 * 1024,
  permission: "ai.study",
  capability: "study_studio",
  module: "ai_student",
  run: (ctx, input) => translateMaterial(ctx, input, "student"),
});
