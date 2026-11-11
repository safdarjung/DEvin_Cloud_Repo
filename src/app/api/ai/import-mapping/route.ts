import "server-only";
// features-18 §H step 3 — import mapping: entity type + spreadsheet headers
// (headers only, <= 40, each <= 80 chars) -> header -> allowed import column or
// null. Exact/alias matches come from the deterministic matcher; the model sees
// only the leftovers. Suggestions are applied only after the owner confirms them
// in the setup wizard. Persists nothing.
import { ok, type ActionResult } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { aiTaskRoute } from "@/modules/ai/task-route";
import {
  applyModelMatches,
  buildImportMappingPrompt,
  deterministicImportMatches,
  IMPORT_COLUMNS,
  IMPORT_MAPPING_INSTRUCTIONS,
  ImportMappingGenerationSchema,
  ImportMappingRequestSchema,
  type ImportSuggestion,
} from "@/modules/ai/import-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// <= 40 short matches (lesson 9: always cap output).
const MAX_OUTPUT_TOKENS = 1024;

interface ImportMappingData {
  suggestions: ImportSuggestion[];
  provider: "local" | "cloud" | null;
  model: string | null;
}

export const POST = aiTaskRoute({
  route: "import-mapping",
  schema: ImportMappingRequestSchema,
  maxBodyBytes: 8 * 1024,
  permission: "data.import",
  capability: "import_mapping",
  run: async (ctx, input): Promise<ActionResult<ImportMappingData>> => {
    const { headers, det, leftovers, free } = deterministicImportMatches(input.headers, IMPORT_COLUMNS[input.entityType]);

    let aiMatches = new Map<string, string>();
    let meta: Pick<ImportMappingData, "provider" | "model"> = { provider: null, model: null };
    if (leftovers.length > 0 && free.length > 0) {
      const generated = await runStructured({
        ctx,
        feature: "import_mapping",
        schema: ImportMappingGenerationSchema,
        instructions: IMPORT_MAPPING_INSTRUCTIONS,
        prompt: buildImportMappingPrompt(input.entityType, leftovers, free),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      if (!generated.ok) return generated;
      aiMatches = applyModelMatches(leftovers, free, generated.data.data);
      meta = { provider: generated.data.provider, model: generated.data.model };
    }

    const suggestions = headers.map((header): ImportSuggestion => {
      const rule = det[header];
      if (rule) return { header, column: rule, source: "rules" };
      const ai = aiMatches.get(header);
      return ai ? { header, column: ai, source: "ai" } : { header, column: null, source: null };
    });
    return ok({ suggestions, ...meta });
  },
});
