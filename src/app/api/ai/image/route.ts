import "server-only";
// /image: one illustration for a lesson, drawn by the cloud provider. Draft only: the
// picture goes back in the answer and is stored nowhere.
import { makeImage } from "@/modules/ai/explain/generate";
import { explainRoute } from "@/modules/ai/explain/route";
import { ImageRequestSchema } from "@/modules/ai/explain/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One picture can take most of a minute.
export const maxDuration = 90;

export const POST = explainRoute({ route: "image", schema: ImageRequestSchema, maxBodyBytes: 4 * 1024, run: makeImage });
