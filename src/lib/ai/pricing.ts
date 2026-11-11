// 04 §5, 12 §2 — USD-per-million-token price table for the configured cloud
// models. Local inference has no per-token API cost (hardware/energy cost
// is estimated separately by `pnpm ai:bench`, T-040); the gateway always
// labels this number an estimate (07 §5), never a bill.

export interface ModelPrice {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

// Keyed by model id, not by env var name, so a successor id swapped in via
// `AI_CLOUD_MODEL_QUALITY`/`AI_CLOUD_MODEL_CHEAP` still prices correctly.
const CLOUD_PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5": { inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
  "claude-haiku-4-5": { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
  "claude-sonnet-5-5": { inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
  "claude-haiku-5-5": { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 },
  // Z.ai's cheap paid tier (ZAI_MODEL); the default glm-4.7-flash is free, so $0 like Gemini below.
  "glm-5.3-flash": { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.5 },
  // Fix round 1 (security review, LOW-2): `gemini-flash-lite-latest` (the
  // teacher agent, D28) is deliberately left out of this table, not
  // forgotten — `estimateCost` falls through its "unknown model id" branch
  // and reports $0, which matches the free tier it runs on today. Add a
  // real row here (and stop relying on the fallback) the day that tier
  // stops being free.
};

export function estimateCost(
  provider: "local" | "cloud",
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  if (provider === "local") return 0;

  const price = CLOUD_PRICES[model];
  if (!price) return 0; // unknown/future model id — never block a response on a missing price row

  return (inputTokens / 1_000_000) * price.inputUsdPerMTok + (outputTokens / 1_000_000) * price.outputUsdPerMTok;
}
