import "server-only";
// Ask a question about, or summarise, a PDF or photo the person uploaded. Draft only: nothing is saved.
import { askFile } from "@/modules/ai/explain/generate";
import { explainRoute } from "@/modules/ai/explain/route";
import { FileAskRequestSchema } from "@/modules/ai/explain/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const POST = explainRoute({ route: "file-ask", schema: FileAskRequestSchema, maxBodyBytes: 4 * 1024, run: askFile });
