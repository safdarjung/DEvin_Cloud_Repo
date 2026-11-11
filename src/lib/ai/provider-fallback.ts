import "server-only";
// Cloud provider fallback + honest error mapping (gateway layer). Only ever
// moves between the D28/D29 cloud providers (Z.ai, Groq, Gemini): a request
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
  keys: { groq: boolean; gemini: boolean; zai: boolean };
  /** Estimated whole request; picks Z.ai's one retry. Omitted: treated as too big for Groq. */
  requestTokens?: number;
}

/** `last` is a second retry after `fallback`; absent or null means none. */
export interface CloudPlan {
  primary: AgentProvider;
  fallback: AgentProvider | null;
  last?: AgentProvider | null;
}

/** Owner decision 2026-11-11 (D53, amended): Gemini answers first, Groq is the backup, Z.ai the second backup. */
const CLOUD_ORDER = ["gemini", "groq", "zai"] as const;

/** Keyed providers in order; Groq is skipped as a backup for a request above its ceiling. */
function orderedPlan(keys: CloudPlanInput["keys"], fits: (p: AgentProvider) => boolean, backupFits: (p: AgentProvider) => boolean): CloudPlan | null {
  const keyed = CLOUD_ORDER.filter((p) => keys[p] && fits(p));
  if (keyed.length === 0) return null;
  const [primary, ...rest] = keyed;
  const backups = rest.filter(backupFits);
  return { primary, fallback: backups[0] ?? null, ...(backups[1] ? { last: backups[1] } : {}) };
}

/**
 * Which cloud provider answers a chat and which ones get the retries. Only
 * providers with a key are ever named. Gemini first, then Groq (only when the
 * request fits Groq's ceiling), then Z.ai. `preferred` (the old Groq/Gemini
 * routing pick) no longer changes the order.
 */
export function cloudProviderPlan({ mode, keys, requestTokens = Infinity }: CloudPlanInput): CloudPlan | null {
  if (mode !== "cloud") return null;
  return orderedPlan(keys, () => true, (p) => p !== "groq" || requestTokens <= TOKEN_CEILING.groq);
}

/**
 * A one-shot structured call (runStructured): the keyed providers whose
 * per-request ceiling (TOKEN_CEILING, the same one chat uses) holds the whole
 * request, in order Gemini, Groq, Z.ai; the later ones are the retries.
 * "too_large" when a key exists but nothing fits: the caller says so instead
 * of trimming the user's own text. null when no cloud key is set.
 */
export function structuredCloudPlan(keys: CloudPlanInput["keys"], requestTokens: number): CloudPlan | "too_large" | null {
  if (!CLOUD_ORDER.some((p) => keys[p])) return null;
  const fits = (p: AgentProvider) => requestTokens <= TOKEN_CEILING[p];
  return orderedPlan(keys, fits, fits) ?? "too_large";
}

export function configuredCloudKeys(): CloudPlanInput["keys"] {
  return { groq: Boolean(process.env.GROQ_API_KEY), gemini: Boolean(process.env.GEMINI_API_KEY), zai: Boolean(process.env.ZAI_API_KEY) };
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
// with strictJsonSchema off. Z.ai gets the schema as prompt text (schemaRules), never as a schema.
const UNSUPPORTED_SCHEMA_KEYS: Record<AgentProvider, readonly string[]> = { groq: [], gemini: ["maxItems"], zai: [] };

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

// Z.ai silently ignores json_schema (answers fenced markdown with extra keys), so it
// gets JSON-object mode with the schema in its system prompt; Zod validates after.
type ModelPrompt = Parameters<NonNullable<LanguageModelMiddleware["transformParams"]>>[0]["params"]["prompt"];

function schemaInPrompt(prompt: ModelPrompt, schema: JSONSchema7): ModelPrompt {
  const note = `JSON schema:\n${JSON.stringify(schema)}\nYou MUST answer with a JSON object that matches the JSON schema above.`;
  const [first, ...rest] = prompt;
  return first?.role === "system" ? [{ ...first, content: `${first.content}\n\n${note}` }, ...rest] : [{ role: "system", content: note }, ...prompt];
}

function schemaRules(provider: AgentProvider): LanguageModelMiddleware {
  return {
    transformParams: async ({ params }) => {
      if (params.responseFormat?.type !== "json" || !params.responseFormat.schema) return params;
      if (provider === "zai") return { ...params, prompt: schemaInPrompt(params.prompt, params.responseFormat.schema), responseFormat: { type: "json" } };
      return { ...params, responseFormat: { ...params.responseFormat, schema: sanitizeSchemaFor(provider, params.responseFormat.schema) } };
    },
  };
}

// Looked up per call, so the provider modules stay lazy (C-62) and test mocks need only what a test uses.
const FACTORY: Record<AgentProvider, { id: () => string; get: () => Promise<LanguageModel> }> = {
  groq: { id: () => providers.groqModelId(), get: () => providers.getGroqModel() },
  gemini: { id: () => providers.geminiModelId(), get: () => providers.getGeminiModel() },
  zai: { id: () => providers.zaiModelId(), get: () => providers.getZaiModel() },
};

export function agentModelId(provider: AgentProvider): string {
  return FACTORY[provider].id();
}

export interface CloudModel {
  model: LanguageModel;
  /** Model ids that answered, in order (two when a fallback answered a later step). */
  modelsUsed: () => string[];
}

/**
 * How long one provider may take when another is still in line. Z.ai's free
 * model was seen to hang past the gateway's whole budget (2026-11-11), which
 * left no time for the retry. The last provider in line is not capped.
 */
export const ATTEMPT_TIMEOUT_MS = 10_000;
/** A provider that just failed is skipped for this long (per server instance), so later requests do not wait on it again. */
export const COOLDOWN_MS = 60_000;

/** Pause before the one extra pass over every provider when all of them failed. */
export const SECOND_PASS_WAIT_MS = 1_500;

class AttemptTimeout extends Error {}

const coolUntil = new Map<AgentProvider, number>();

/** Tests only: forget which providers failed recently. */
export function resetProviderCooldowns(): void {
  coolUntil.clear();
}

function capped<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AttemptTimeout("provider attempt timed out")), ATTEMPT_TIMEOUT_MS);
  });
  // The slow request is left to the caller's own abort signal; its late result or error is ignored.
  return Promise.race([Promise.resolve(work), limit]).finally(() => clearTimeout(timer));
}

/**
 * The primary provider's model, wrapped so that a call that fails or hangs
 * before any token moves to the next provider in line (`fallback`, then
 * `last`) with the same (already redacted) prompt and tools. Any error moves
 * on, not only size/rate ones: a person waiting for an answer is better served
 * by the next provider than by one provider's bad key or schema complaint; the
 * failure is logged. A provider that failed is skipped for COOLDOWN_MS, also
 * by later requests on this server instance. Throws when the primary's key is
 * missing, like `getGroqModel`/`getGeminiModel`.
 */
export async function cloudModelWithFallback(primary: AgentProvider, fallback: AgentProvider | null, last: AgentProvider | null = null): Promise<CloudModel> {
  const used: string[] = [];
  const note = (id: string) => {
    if (!used.includes(id)) used.push(id);
  };
  const base = await FACTORY[primary].get();
  // A bare model id string resolves through the SDK's global provider: nothing to wrap.
  if (typeof base === "string") return { model: base, modelsUsed: () => [FACTORY[primary].id()] };
  const order: AgentProvider[] = [primary, ...[fallback, last].filter((p): p is AgentProvider => p !== null && p !== primary)];
  const models = new Map<AgentProvider, WrappedModel | null>();
  const modelFor = async (provider: AgentProvider): Promise<WrappedModel | null> => {
    if (!models.has(provider)) {
      const next = await FACTORY[provider].get().catch(() => null);
      models.set(provider, next === null || typeof next === "string" ? null : wrapLanguageModel({ model: next, middleware: schemaRules(provider) }));
    }
    return models.get(provider) ?? null;
  };
  const run = async <T>(aborted: () => boolean, first: () => PromiseLike<T>, call: (m: WrappedModel) => PromiseLike<T>): Promise<T> => {
    let err: unknown = new Error("no cloud provider available");
    // Second pass: free tiers answer 503/429 in bursts, and a short wait often clears them (2026-11-11).
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) await new Promise((resolve) => setTimeout(resolve, SECOND_PASS_WAIT_MS));
      const now = Date.now();
      const ready = order.filter((p) => (coolUntil.get(p) ?? 0) <= now);
      // Everything failed recently (always so on the second pass): try them all again rather than refuse.
      const line = pass === 0 && ready.length > 0 ? ready : order;
      let from: AgentProvider | null = null;
      for (let i = 0; i < line.length; i++) {
        const provider = line[i];
        const model = provider === primary ? null : await modelFor(provider);
        if (provider !== primary && !model) continue;
        if (from) {
          const info = err instanceof AttemptTimeout ? { status: undefined, kind: "timeout" } : classifyAiError(err);
          console.warn("[ai-fallback] retrying on the other provider", { from, to: provider, status: info.status, kind: info.kind });
        }
        try {
          const work = model ? call(model) : first();
          const result = await (i < line.length - 1 ? capped(work) : work);
          note(FACTORY[provider].id());
          return result;
        } catch (e) {
          if (aborted()) throw e;
          err = e;
          from = provider;
          // A request too large for this provider says nothing about its health.
          if (e instanceof AttemptTimeout || classifyAiError(e).kind !== "too_large") coolUntil.set(provider, Date.now() + COOLDOWN_MS);
        }
      }
      // One provider only, or nothing worth waiting for: no second pass.
      if (order.length < 2 || !(err instanceof AttemptTimeout || shouldFallback(err))) break;
    }
    throw err;
  };
  const middleware: LanguageModelMiddleware = {
    wrapGenerate: ({ doGenerate, params }) => run(() => params.abortSignal?.aborted === true, doGenerate, (m) => m.doGenerate(params)),
    wrapStream: ({ doStream, params }) => run(() => params.abortSignal?.aborted === true, doStream, (m) => m.doStream(params)),
  };
  // Fallback outermost: a retry gets the caller's params, not the primary's provider-shaped ones.
  return { model: wrapLanguageModel({ model: base, middleware: [middleware, schemaRules(primary)] }), modelsUsed: () => (used.length ? [...used] : [FACTORY[primary].id()]) };
}
