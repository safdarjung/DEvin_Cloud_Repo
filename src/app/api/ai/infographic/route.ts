import "server-only";
// /infographic: a one-page poster of a topic, or of an anatomy/teardown the
// person already has on screen (fromAnatomy). Draft only.
import { makeInfographic } from "@/modules/ai/explain/generate";
import { explainRoute } from "@/modules/ai/explain/route";
import { InfographicRequestSchema } from "@/modules/ai/explain/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A full anatomy result is at most ~16,000 characters; Hindi takes up to 3 bytes each.
export const POST = explainRoute({ route: "infographic", schema: InfographicRequestSchema, maxBodyBytes: 64 * 1024, run: makeInfographic });
