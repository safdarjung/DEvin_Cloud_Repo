import "server-only";
// 0150 / Phase 4 — AI marks + feedback for one submitted written answer.
// Thin JSON wrapper over the suggestMarks action (online-tests/actions.ts),
// which runs the gateway (ai_policy plan, redaction, quota) and writes ONLY
// ai_suggested_marks / ai_feedback via public.save_test_ai_suggestion
// (rule 6). The teacher's marks are saved separately with saveMarks.
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { suggestMarks } from "@/modules/online-tests/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SuggestMarksRequestSchema = z.object({ institutionSlug: z.string().trim().min(1).max(100), responseId: uuid }).strict();

export const POST = aiTaskRoute({
  route: "online-tests/suggest-marks",
  schema: SuggestMarksRequestSchema,
  maxBodyBytes: 2 * 1024,
  permission: "online_test.mark",
  capability: "answer_marking",
  run: (ctx, input) => suggestMarks(ctx.institution.slug, { responseId: input.responseId }),
});
