import "server-only";
// /flashcards: a topic (or the person's own file) as a deck to flip through. Practice only: nothing is saved.
import { makeFlashcards } from "@/modules/ai/explain/generate";
import { explainRoute } from "@/modules/ai/explain/route";
import { VisualRequestSchema } from "@/modules/ai/explain/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const POST = explainRoute({ route: "flashcards", schema: VisualRequestSchema, maxBodyBytes: 4 * 1024, run: makeFlashcards });
