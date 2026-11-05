// M19-T14 — job `insights.detect` (M19-tasks.md rulings "Detection pipeline"
// > Handler, Writer). Payload `{ as_of: "YYYY-MM-DD" }` built in SQL by
// `public.enqueue_insight_detection` (T6) — never trust it beyond that date.
// Relative `.ts` value imports: `pnpm jobs:run` loads this file as plain node.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/db/types";
import { isModuleEnabled } from "../../../lib/modules/catalog.ts";
import { DETECTORS } from "../../insights/detectors/index.ts";
import { capPerSignal, type InsightCandidate } from "../../insights/signals.ts";
import type { JobHandler } from "../types.ts";

const CAP_PER_SIGNAL = 20;

const PayloadSchema = z
  .object({
    as_of: z.string().min(1),
  })
  .strict();

/** The detector pipeline's only writer (service_role only). Throws on error. */
export async function recordInsights(
  admin: SupabaseClient<Database>,
  institutionId: string,
  candidates: InsightCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0;
  const { data, error } = await admin.rpc("record_insights", {
    p_institution_id: institutionId,
    // `InsightCandidate` has no index signature, so it isn't structurally a
    // `Json` object to the generated types — it is one at runtime (plain
    // snake_case fields only), same as `record_insights`'s jsonb param.
    p_rows: candidates as unknown as Json,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export const insightsDetect: JobHandler = async (job, { admin }) => {
  // Validated before any rpc call (a bad payload must never reach the db).
  const payload = PayloadSchema.parse(job.payload);
  const institutionId = job.institution_id;
  if (!institutionId) throw new Error("insights.detect: missing institution_id");

  const { data: institution, error: institutionError } = await admin
    .from("institutions")
    .select("settings")
    .eq("id", institutionId)
    .single();
  if (institutionError) throw institutionError;
  const settings = (institution.settings as Record<string, unknown> | null) ?? {};

  if (!isModuleEnabled({ institution: { settings } }, "insights")) return;

  const cid = crypto.randomUUID();
  const failed: string[] = [];

  for (const detector of DETECTORS) {
    if (!isModuleEnabled({ institution: { settings } }, detector.module)) continue;
    try {
      const candidates = await detector.run(admin, { institutionId, asOf: payload.as_of, settings });
      const capped = capPerSignal(candidates, CAP_PER_SIGNAL);
      await recordInsights(admin, institutionId, capped);
    } catch (err) {
      // Never log the candidates (may hold evidence derived from rows) — key only.
      console.error(`[${cid}] insights detector ${detector.key} failed`, {
        message: err instanceof Error ? err.message : "unknown error",
      });
      failed.push(detector.key);
    }
  }

  if (failed.length > 0) throw new Error(`detectors failed: ${failed.join(", ")}`);
};
