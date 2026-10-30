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

// D28 — the teacher tool-calling agent's model. Deliberately separate from
// the cloud tier above: this is a parallel, Gemini-only path for that one
// agent, out of band from `local_only`/`cloud_allowed` institution policy
// (see 12-decision-log.md ADR D28). `gemini-flash-lite-latest` is the
// verified-fast tier; `gemini-3.8-flash` measured ~400s/call, unusable.
export function geminiModelId(): string {
  return process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest";
}

/**
 * Lazily imported, same reason as `getCloudModel` below (C-62) — never
 * loaded for a request that doesn't reach the teacher agent route. Throws
 * if `GEMINI_API_KEY` is unset; the caller must map that to a clear
 * `ai_unavailable` error and never fall back to local/cloud Anthropic.
 */
export async function getGeminiModel(): Promise<LanguageModel> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  const google = createGoogleGenerativeAI({ apiKey });
  return google(geminiModelId());
}

// D29 — the teacher agent's "routine" tier, routed alongside Gemini (see
// 12-decision-log.md ADR D29 for the routing rule and its honest limits).
// `openai/gpt-oss-120b` measured faster AND no worse than the smaller
// `openai/gpt-oss-20b` on this key — no real tradeoff, so no separate
// "cheap" env knob the way cloudModelId() has one.
export function groqModelId(): string {
  return process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
}

/** Same contract as `getGeminiModel`: lazy import (C-62 shape), throws if
 * `GROQ_API_KEY` is unset — the caller maps that to `ai_unavailable`. */
export async function getGroqModel(): Promise<LanguageModel> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured.");
  }
  const { createGroq } = await import("@ai-sdk/groq");
  const groq = createGroq({ apiKey });
  return groq(groqModelId());
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
