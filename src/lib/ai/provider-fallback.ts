import "server-only";
// Cloud provider fallback + honest error mapping (gateway layer). Only ever
// moves between the two D28/D29 cloud providers (Groq, Gemini): a request
// the caller routed locally (role cloud switch off, keyless install, the
// local plan) never reaches this file, and a provider without a key is
// never tried. `ai_policy` still governs only Anthropic (DBT-157).
import { APICallError, RetryError, wrapLanguageModel, type JSONSchema7, type LanguageModel, type LanguageModelMiddleware } from "ai";
import { fail, type ErrorCode } from "@/lib/actions/result";
import * as providers from "@/lib/ai/providers";
import { TOKEN_CEILING } from "@/lib/ai/tool-budget";
import type { AgentProvider } from "@/modules/ai/agent/provider-routing";

export type AiErrorKind = "busy" | "too_large" | "not_configured" | "unavailable";

export interface AiErrorInfo {
  kind: AiErrorKind;
  status?: number;
  /** Provider error code when it sent one (e.g. "rate_limit_exceeded"); logged, never shown. */
  providerCode?: string;
}

const SIZE_PATTERN = /request[_ ]too[_ ]large|context[_ ]length|maximum context|too many tokens|prompt is too long/i;
const RATE_PATTERN = /rate[_ ]limit|resource[_ ]exhausted|quota|overloaded/i;

/** Status/code only: provider messages can echo request data or org ids and never leave the server. */
export function classifyAiError(error: unknown): AiErrorInfo {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (!APICallError.isInstance(cause)) return { kind: "unavailable" };
  const status = cause.statusCode;
  const body = `${cause.responseBody ?? ""} ${cause.message}`;
  const providerCode = /"code"\s*:\s*"([a-z_]{1,40})"/i.exec(cause.responseBody ?? "")?.[1];
  if (status === 413 || SIZE_PATTERN.test(body)) return { kind: "too_large", status, providerCode };
  if (status === 401 || status === 403 || status === 404) return { kind: "not_configured", status, providerCode };
  if (status === 429 || (status !== undefined && status >= 500) || RATE_PATTERN.test(body)) return { kind: "busy", status, providerCode };
  return { kind: "unavailable", status, providerCode };
}

/** 413, 429, 5xx, or a size/rate code: worth one try on the other provider. */
export function shouldFallback(error: unknown): boolean {
  const { kind } = classifyAiError(error);
  return kind === "busy" || kind === "too_large";
}

export interface CloudPlanInput {
  /** "local" when the caller routed this request locally (role cloud switch off, keyless install): never any cloud. */
  mode: "local" | "cloud";
  /** The routing pick (pickAgentProvider). */
  preferred: AgentProvider;
  keys: { groq: boolean; gemini: boolean };
}

/**
 * Which cloud provider answers and which one (if any) gets the one retry.
 * Only providers with a key are ever named; the preferred one yields to the
 * other when its own key is missing.
 */
export function cloudProviderPlan({ mode, preferred, keys }: CloudPlanInput): { primary: AgentProvider; fallback: AgentProvider | null } | null {
  if (mode !== "cloud") return null;
  const other: AgentProvider = preferred === "groq" ? "gemini" : "groq";
  if (keys[preferred]) return { primary: preferred, fallback: keys[other] ? other : null };
  return keys[other] ? { primary: other, fallback: null } : null;
}

/**
 * A one-shot structured call (runStructured): the first keyed provider whose
 * per-request ceiling (TOKEN_CEILING, the same one chat uses) holds the whole
 * request, Groq first; the other keyed one that also fits gets the one retry.
 * "too_large" when a key exists but nothing fits: the caller says so instead
 * of trimming the user's own text. null when no Groq/Gemini key is set.
 */
export function structuredCloudPlan(
  keys: CloudPlanInput["keys"],
  requestTokens: number,
): { primary: AgentProvider; fallback: AgentProvider | null } | "too_large" | null {
  const keyed = (["groq", "gemini"] as const).filter((p) => keys[p]);
  if (keyed.length === 0) return null;
  const fits = keyed.filter((p) => requestTokens <= TOKEN_CEILING[p]);
  return fits.length === 0 ? "too_large" : { primary: fits[0], fallback: fits[1] ?? null };
}

export function configuredCloudKeys(): CloudPlanInput["keys"] {
  return { groq: Boolean(process.env.GROQ_API_KEY), gemini: Boolean(process.env.GEMINI_API_KEY) };
}

const USER_MESSAGE: Record<AiErrorKind, { code: ErrorCode; message: string }> = {
  busy: { code: "rate_limited", message: "The AI service is busy right now. Please try again in a minute." },
  too_large: {
    code: "ai_unavailable",
    message: "This question needs more school data than the assistant can reach at once. Ask about one class, student or topic.",
  },
  not_configured: { code: "ai_unavailable", message: "AI is not set up correctly for this school. Please tell your administrator." },
  unavailable: { code: "ai_unavailable", message: "The assistant could not answer right now. Please try again." },
};

export function userFacingAiError(kind: AiErrorKind): { code: ErrorCode; message: string } {
  return USER_MESSAGE[kind];
}

/**
 * Stream `errorText` for the chat UIs: an ActionResult envelope (the shape
 * `chatErrorMessage` already parses from non-2xx bodies) with a category
 * message only. The stream's own `onError` logs code, status, provider and
 * estimated tokens server-side (cloud-stream.ts, gateway.ts).
 */
export function streamErrorText(error: unknown): string {
  const { code, message } = userFacingAiError(classifyAiError(error).kind);
  return JSON.stringify(fail(code, message));
}

type WrappedModel = ReturnType<typeof wrapLanguageModel>;

// Structured-output schema keywords a provider refuses. Zod still validates the
// output strictly after generation, so dropping a bound here never loosens what
// is accepted. Gemini answers 400 INVALID_ARGUMENT to nested arrays bounded by
// maxItems (the website page draft schema, 2026-11-11); Groq takes everything
// with strictJsonSchema off.
const UNSUPPORTED_SCHEMA_KEYS: Record<AgentProvider, readonly string[]> = { groq: [], gemini: ["maxItems"] };

export function sanitizeSchemaFor(provider: AgentProvider, schema: JSONSchema7): JSONSchema7 {
  const drop = UNSUPPORTED_SCHEMA_KEYS[provider];
  // `properties` maps user field names: walk the values, never filter the names.
  const walk = (node: unknown, isPropertyMap = false): unknown => {
    if (Array.isArray(node)) return node.map((child) => walk(child));
    if (node === null || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => isPropertyMap || !drop.includes(key))
        .map(([key, value]) => [key, walk(value, !isPropertyMap && key === "properties")]),
    );
  };
  return drop.length === 0 ? schema : (walk(schema) as JSONSchema7);
}

function schemaRules(provider: AgentProvider): LanguageModelMiddleware {
  return {
    transformParams: async ({ params }) =>
      params.responseFormat?.type === "json" && params.responseFormat.schema
        ? { ...params, responseFormat: { ...params.responseFormat, schema: sanitizeSchemaFor(provider, params.responseFormat.schema) } }
        : params,
  };
}

// Looked up per call, so the provider modules stay lazy (C-62) and test mocks need only what a test uses.
const FACTORY: Record<AgentProvider, { id: () => string; get: () => Promise<LanguageModel> }> = {
  groq: { id: () => providers.groqModelId(), get: () => providers.getGroqModel() },
  gemini: { id: () => providers.geminiModelId(), get: () => providers.getGeminiModel() },
};

export interface CloudModel {
  model: LanguageModel;
  /** Model ids that answered, in order (two when a fallback answered a later step). */
  modelsUsed: () => string[];
}

/**
 * The primary provider's model, wrapped so that a call failing with a
 * size/rate/overload error before any token is retried once on `fallback`
 * with the same (already redacted) prompt and tools. Throws when the
 * primary's key is missing, like `getGroqModel`/`getGeminiModel`.
 */
export async function cloudModelWithFallback(primary: AgentProvider, fallback: AgentProvider | null): Promise<CloudModel> {
  const used: string[] = [];
  const note = (id: string) => {
    if (!used.includes(id)) used.push(id);
  };
  const base = await FACTORY[primary].get();
  // A bare model id string resolves through the SDK's global provider: nothing to wrap.
  if (typeof base === "string") return { model: base, modelsUsed: () => [FACTORY[primary].id()] };
  let fallbackModel: WrappedModel | null = null;
  const getFallback = async () => {
    if (!fallback) return null;
    const next = await FACTORY[fallback].get();
    if (typeof next === "string") return null;
    fallbackModel ??= wrapLanguageModel({ model: next, middleware: schemaRules(fallback) });
    return fallbackModel;
  };
  // Sticky per request: once the primary is out of tokens/busy, later steps go straight to the fallback.
  let switched = false;
  const onFallback = async <T>(call: (m: WrappedModel) => PromiseLike<T>, model: WrappedModel): Promise<T> => {
    const result = await call(model);
    note(FACTORY[fallback as AgentProvider].id());
    return result;
  };
  const retry = async <T>(err: unknown, call: (m: WrappedModel) => PromiseLike<T>): Promise<T> => {
    const model = shouldFallback(err) ? await getFallback().catch(() => null) : null;
    if (!model || !fallback) throw err;
    const info = classifyAiError(err);
    console.warn("[ai-fallback] retrying on the other provider", { from: primary, to: fallback, status: info.status, kind: info.kind });
    switched = true;
    return onFallback(call, model);
  };
  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate, params }) => {
      if (switched && fallbackModel) return onFallback((m) => m.doGenerate(params), fallbackModel);
      try {
        const result = await doGenerate();
        note(FACTORY[primary].id());
        return result;
      } catch (err) {
        return retry(err, (m) => m.doGenerate(params));
      }
    },
    wrapStream: async ({ doStream, params }) => {
      if (switched && fallbackModel) return onFallback((m) => m.doStream(params), fallbackModel);
      try {
        const result = await doStream();
        note(FACTORY[primary].id());
        return result;
      } catch (err) {
        return retry(err, (m) => m.doStream(params));
      }
    },
  };
  return { model: wrapLanguageModel({ model: base, middleware: [schemaRules(primary), middleware] }), modelsUsed: () => (used.length ? [...used] : [FACTORY[primary].id()]) };
}
