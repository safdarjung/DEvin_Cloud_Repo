import "server-only";
import { createOllama } from "ai-sdk-ollama";
import type { ImageModel, LanguageModel } from "ai";

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
  // DBT-36 partial fix (GU-08 security review, M3): an Ollama `*-cloud`
  // model tag runs on ollama.com through a local daemon — D32's "local
  // AI never leaves the school's server" guarantee would be silently
  // false for exactly the feature that most needs it (student data). The
  // remaining half of DBT-36 (asserting `OLLAMA_BASE_URL` itself is
  // loopback/private) is deliberately NOT done here — a hosted deployment
  // can legitimately point it at a tunnel to the school's own box
  // (04-architecture.md topology B), so a blanket host check would break
  // that; it needs an explicit allow-list or an operator attestation
  // instead, not a quick assertion.
  if (OLLAMA_MODEL.endsWith("-cloud")) {
    throw new Error("OLLAMA_MODEL may not be a *-cloud tag — that runs on ollama.com, not locally.");
  }
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

/** The Gemini text model with Google Search grounding switched on (web resources); same key and lazy import. */
export async function getGeminiSearch(): Promise<{ model: LanguageModel; tools: Record<string, unknown> }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  const google = createGoogleGenerativeAI({ apiKey });
  return { model: google(geminiModelId()), tools: { google_search: google.tools.googleSearch({}) } };
}

/** The Gemini model that draws pictures (/image); a different model family from the text one. */
export function geminiImageModelId(): string {
  return process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
}

/** Lazily imported like `getGeminiModel` (C-62). Throws if `GEMINI_API_KEY` is unset; the gateway checks the key first. */
export async function getGeminiImageModel(): Promise<ImageModel> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  return createGoogleGenerativeAI({ apiKey }).image(geminiImageModelId());
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

// Owner decision 2026-11-12: NVIDIA NIM answers first whenever NVIDIA_API_KEY is set; Gemini, Groq
// and Z.ai are the backups (provider-fallback.ts). OpenAI-compatible endpoint; it calls tools and
// follows a JSON schema. Thinking is off by default for speed (NIM_THINKING=true turns it on).
export function nimModelId(): string {
  return process.env.NIM_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b";
}

export async function getNimModel(): Promise<LanguageModel> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY is not configured.");
  }
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const thinking = process.env.NIM_THINKING === "true";
  const nim = createOpenAICompatible({
    name: "nim",
    baseURL: process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
    apiKey,
    includeUsage: true,
    supportsStructuredOutputs: true,
    transformRequestBody: (body) => ({ ...body, chat_template_kwargs: { enable_thinking: thinking } }),
  });
  return nim(nimModelId());
}

// Owner decision 2026-11-11: Z.ai (GLM) answers first whenever ZAI_API_KEY is
// set; Groq/Gemini become its one retry (provider-fallback.ts). The free
// `glm-4.7-flash` is the default; `glm-5.3-flash` is the cheap paid tier.
export function zaiModelId(): string {
  return process.env.ZAI_MODEL ?? "glm-4.7-flash";
}

/** Same contract as `getGroqModel`: lazy import (C-62 shape), throws if
 * `ZAI_API_KEY` is unset — the caller maps that to `ai_unavailable`. */
export async function getZaiModel(): Promise<LanguageModel> {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) {
    throw new Error("ZAI_API_KEY is not configured.");
  }
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const modelId = zaiModelId();
  // GLM thinks unless told not to (slow, burns tokens); glm-5.3* cannot turn it off, only down.
  const thinking = modelId.startsWith("glm-5.3") ? { reasoning_effort: "low" } : { thinking: { type: "disabled" } };
  const zai = createOpenAICompatible({
    name: "zai",
    baseURL: "https://api.z.ai/api/paas/v4",
    apiKey,
    includeUsage: true,
    // Z.ai silently ignores json_schema: JSON-object mode, schema in the prompt (provider-fallback.ts).
    supportsStructuredOutputs: false,
    transformRequestBody: (body) => ({ ...body, ...thinking }),
  });
  return zai(modelId);
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
