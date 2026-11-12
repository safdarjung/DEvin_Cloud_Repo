import "server-only";
// /diagram: a process, cycle or decision as a flowchart. Draft only.
import { makeDiagram } from "@/modules/ai/explain/generate";
import { explainRoute } from "@/modules/ai/explain/route";
import { VisualRequestSchema } from "@/modules/ai/explain/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = explainRoute({ route: "diagram", schema: VisualRequestSchema, maxBodyBytes: 4 * 1024, run: makeDiagram });
