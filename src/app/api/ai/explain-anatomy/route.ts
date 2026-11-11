import "server-only";
// /anatomy and /teardown: explain the parts of a thing and how it works, from
// a typed subject or a photo/PDF on the caller's study shelf. Draft only.
import { explainAnatomy } from "@/modules/ai/explain/generate";
import { explainRoute } from "@/modules/ai/explain/route";
import { AnatomyRequestSchema } from "@/modules/ai/explain/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = explainRoute({ route: "explain-anatomy", schema: AnatomyRequestSchema, maxBodyBytes: 4 * 1024, run: explainAnatomy });
