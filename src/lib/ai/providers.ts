import "server-only";
import { createOllama } from "ai-sdk-ollama";
import type { LanguageModel } from "ai";

// 04 §5, 11 §1 — env-configured local provider. Safe to import eagerly:
// `ai-sdk-ollama` does no network I/O at import time, and local is in every
// policy's plan (06 §W10), so there is no "never load this" requirement
// here the way there is for the cloud provider below.
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:4b-instruct-2507-q4_K_M";

export function localModelId(): string {
  return OLLAMA_MODEL;
}

export function getLocalModel(): LanguageModel {
  const ollama = createOllama({ baseURL: OLLAMA_BASE_URL });
  return ollama(OLLAMA_MODEL);
}

export type CloudTier = "quality" | "cheap";

export function cloudModelId(tier: CloudTier = "quality"): string {
  return tier === "quality"
    ? process.env.AI_CLOUD_MODEL_QUALITY ?? "claude-sonnet-5"
    : process.env.AI_CLOUD_MODEL_CHEAP ?? "claude-haiku-4-5";
}

/**
 * The ONLY place `@ai-sdk/anthropic` is imported — lazily and dynamically,
 * so the module is never loaded into the process when the plan never
 * includes "cloud" (C-62). The gateway must call this exclusively from
 * inside its `step === "cloud"` branch; tests spy this export directly to
 * assert it was never called under `local_only` (06 §W10 C-62).
 */
export async function getCloudModel(tier: CloudTier = "quality"): Promise<LanguageModel> {
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic(cloudModelId(tier));
}
