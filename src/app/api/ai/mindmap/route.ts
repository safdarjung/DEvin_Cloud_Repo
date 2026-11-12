import "server-only";
// /mindmap: a topic as a mind map (centre, branches, twigs, leaves). Draft only.
import { makeMindMap } from "@/modules/ai/explain/generate";
import { explainRoute } from "@/modules/ai/explain/route";
import { VisualRequestSchema } from "@/modules/ai/explain/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = explainRoute({ route: "mindmap", schema: VisualRequestSchema, maxBodyBytes: 4 * 1024, run: makeMindMap });
