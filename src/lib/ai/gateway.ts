import "server-only";
import { asSchema, generateImage, generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, streamText, type ModelMessage, type StopCondition, type ToolSet } from "ai";
import type { z } from "zod";
import { fail, ok, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import type { Permission } from "@/lib/auth/permissions";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { resolvePlan, type AiPolicy, type ProviderStep } from "@/lib/ai/policy";
import { redact } from "@/lib/ai/redact";
import { estimateCost } from "@/lib/ai/pricing";
import { acquireConcurrencySlot, aiSettingsFor, checkLimits, logUsage, releaseConcurrencySlot } from "@/lib/ai/usage";
import * as providers from "@/lib/ai/providers";
import { streamCloudAgent, type StreamExtras } from "@/lib/ai/cloud-stream";
import {
  agentModelId,
  classifyAiError,
  cloudModelWithFallback,
  configuredCloudKeys,
  picturesEnabled,
  streamErrorText,
  structuredCloudPlan,
  userFacingAiError,
} from "@/lib/ai/provider-fallback";
import { FILE_UNREADABLE_NOW, countPdfPages, fileReadGate } from "@/lib/ai/file-input";
import { TOKEN_CEILING, estimateTokens, planToolBudget, type ToolBudgetHints } from "@/lib/ai/tool-budget";
import { tolerateNullOptionals } from "@/lib/ai/tool-nulls";
import type { AgentProvider } from "@/modules/ai/agent/provider-routing";
import { roleAiConfig } from "@/modules/ai/capabilities/resolve";

// 06 §W10 — local 60s, cloud 30s.
// Cloud: room for up to three providers in line (10 s cap each while another waits, provider-fallback.ts).
const TIMEOUT_MS: Record<ProviderStep, number> = { local: 60_000, cloud: 50_000 };

export interface RunStructuredInput<T> {
  ctx: TenantContext;
  feature: string;
  schema: z.ZodType<T>;
  instructions: string;
  prompt: string;
  /** Names to redact from the prompt before any cloud call (07 §5). */
  denyNames?: readonly string[];
  maxOutputTokens?: number;
  /** Defaults to `ai.generate`; a student-facing caller passes `ai.study`. */
  permission?: Permission;
  /**
   * Owner cloud exception (D28, extended 2026-11-06 — 12-decision-log.md): with
   * `ZAI_API_KEY` (else `GROQ_API_KEY`, else `GEMINI_API_KEY`) set, run on that provider
   * regardless of `ai_policy` (structuredCloudPlan: Gemini also takes a request too big
   * for Groq's ceiling; the next keyed provider that fits gets the one retry on a
   * size/rate error); the prompt is still redacted. Only for prompts without student-personal data; callers opt in
   * one by one, every other caller keeps the policy plan (C-62). D50: a role whose
   * cloud switch is off keeps the policy plan too.
   */
  agentCloud?: boolean;
  /**
   * Rules the provider schema cannot carry (Zod refinements such as "answer is one
   * of the options"): checked on every answer, so a miss gets the one repair retry
   * instead of reaching the caller as an unrepaired failure.
   */
  strictSchema?: z.ZodType;
}

export interface RunStructuredOutput<T> {
  data: T;
  provider: ProviderStep;
  model: string;
  fallback: boolean;
}

function stepModelId(step: ProviderStep): string {
  return step === "local" ? providers.localModelId() : providers.cloudModelId("quality");
}

// Groq checks the JSON against the schema server-side and answers 400 json_validate_failed: same repair path.
function isSchemaValidationError(err: unknown): boolean {
  return NoObjectGeneratedError.isInstance(err) || NoOutputGeneratedError.isInstance(err) || classifyAiError(err).providerCode === "json_validate_failed";
}

function unavailableMessage(step: ProviderStep, aiPolicy: AiPolicy): string {
  return step === "local"
    ? `Local AI engine is not reachable (policy: ${aiPolicy}).`
    : `Cloud AI provider is not reachable (policy: ${aiPolicy}).`;
}

/**
 * 04 §5, 06 §W10/§W11 — the one path every feature uses to call a model.
 * Order: permission → policy plan → quota → rate → concurrency slot →
 * provider call (with one repair retry on invalid output) → usage log →
 * return. Never throws across the action boundary.
 */
export async function runStructured<T>(input: RunStructuredInput<T>): Promise<ActionResult<RunStructuredOutput<T>>> {
  const { ctx, feature, schema, instructions, prompt, denyNames, maxOutputTokens, permission = "ai.generate", agentCloud, strictSchema } = input;

  if (!hasPermission(ctx, permission)) {
    return fail("forbidden", "You do not have permission to use AI features.");
  }

  // The whole request against each provider's per-request ceiling (Groq counts max_tokens too).
  const cloudPlan =
    agentCloud === true && roleAiConfig(ctx, ctx.membership.role).cloud
      ? structuredCloudPlan(
          configuredCloudKeys(),
          estimateTokens(instructions + prompt + JSON.stringify(asSchema(schema).jsonSchema)) + Math.max(maxOutputTokens ?? 1024, 1024),
        )
      : null;
  if (cloudPlan === "too_large") {
    return fail("validation_failed", "This request is too long for the AI service. Shorten the text and try again.");
  }
  const agentModel = cloudPlan?.primary ?? null;
  const plan: ProviderStep[] = agentModel
    ? ["cloud"]
    : resolvePlan({
        aiPolicy: ctx.institution.ai_policy,
        cloudEnabled: process.env.AI_CLOUD_ENABLED === "true",
        hasCloudKey: Boolean(process.env.ANTHROPIC_API_KEY),
      });
  const modelIdFor = (step: ProviderStep): string => (agentModel ? agentModelId(agentModel) : stepModelId(step));
  // Groq's settings ride along whenever Groq may answer, as primary or as the retry; other providers ignore them.
  const groqInPlan = agentModel === "groq" || cloudPlan?.fallback === "groq";

  let limits: Awaited<ReturnType<typeof checkLimits>>;
  try {
    limits = await checkLimits(ctx, feature);
  } catch {
    return fail("dependency_failed", "AI usage limits could not be checked; please try again.");
  }
  if (!limits.ok) {
    await logUsage({
      ctx,
      feature,
      provider: plan[0],
      model: stepModelId(plan[0]),
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      costEstimateUsd: 0,
      ok: false,
      errorCode: limits.code,
      redactions: 0,
    });
    const message =
      limits.code === "quota_exceeded"
        ? "Today's AI limit is used up. It resets at midnight."
        : "Too many AI requests; please slow down and try again.";
    return fail(limits.code, message);
  }

  const settings = aiSettingsFor(ctx);
  let lastFailure: { code: ErrorCode; message: string } = {
    code: "ai_unavailable",
    message: unavailableMessage(plan[0], ctx.institution.ai_policy),
  };

  for (const step of plan) {
    const isFallback = step !== plan[0];
    const concurrencyLimit = step === "local" ? settings.max_concurrent_local : settings.max_concurrent_cloud;

    if (!acquireConcurrencySlot(ctx.institution.id, step, concurrencyLimit)) {
      lastFailure = { code: "rate_limited", message: "AI concurrency limit reached; please try again shortly." };
      continue;
    }

    const startedAt = Date.now();
    let redactions = 0;
    // Everything sent to a cloud provider is redacted: prompt, instructions,
    // and the repair note (which echoes model output).
    const forStep = (text: string): string => {
      if (step !== "cloud") return text;
      const redacted = redact(text, denyNames);
      redactions += redacted.count;
      return redacted.text;
    };

    try {
      const effectivePrompt = forStep(prompt);
      const effectiveInstructions = forStep(instructions);

      // Cloud provider module is imported here, inside this branch only (C-62).
      // D28 path: one retry on the next keyed cloud provider (structuredCloudPlan) on a size/rate/overload error.
      const agentCloudModel =
        step === "cloud" && agentModel
          ? await cloudModelWithFallback(agentModel, cloudPlan?.fallback ?? null, cloudPlan?.last ?? null)
          : null;
      const model =
        step === "local" ? providers.getLocalModel() : agentCloudModel ? agentCloudModel.model : await providers.getCloudModel("quality");

      const attempt = async (repairNote?: string) => {
        const answer = await generateText({
          model,
          instructions: repairNote ? `${effectiveInstructions}\n\n${forStep(repairNote)}` : effectiveInstructions,
          prompt: effectivePrompt,
          output: Output.object({ schema }),
          timeout: TIMEOUT_MS[step],
          // gpt-oss on Groq is a reasoning model: reasoning tokens count against the cap and a
          // truncated JSON comes back as an API error, so keep reasoning low and the cap >= 1024.
          // Strict mode rejects any schema with optional/defaulted keys; Zod still validates the output.
          maxOutputTokens: groqInPlan && maxOutputTokens ? Math.max(maxOutputTokens, 1024) : maxOutputTokens,
          providerOptions: groqInPlan ? { groq: { reasoningEffort: "low", strictJsonSchema: false } } : undefined,
        });
        const strict = strictSchema?.safeParse(answer.output);
        if (strict && !strict.success) {
          const message = strict.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
          throw new NoObjectGeneratedError({ message, response: answer.response, usage: answer.usage, finishReason: answer.finishReason });
        }
        return answer;
      };

      let result;
      try {
        result = await attempt();
      } catch (err) {
        if (!isSchemaValidationError(err)) throw err;
        const detail = err instanceof Error ? err.message : String(err);
        result = await attempt(
          `Your previous response was invalid: ${detail}. Return valid JSON that matches the schema exactly, with no extra text.`,
        );
      }

      const data = result.output;
      const modelId = agentCloudModel ? agentCloudModel.modelsUsed().join("+") : modelIdFor(step);
      const latencyMs = Date.now() - startedAt;
      const costEstimateUsd = estimateCost(step, modelId, result.usage.inputTokens ?? 0, result.usage.outputTokens ?? 0);

      await logUsage({
        ctx,
        feature,
        provider: step,
        model: modelId,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        latencyMs,
        costEstimateUsd,
        ok: true,
        errorCode: null,
        redactions,
      });

      return ok({ data, provider: step, model: modelId, fallback: isFallback });
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const info = classifyAiError(err);
      // Status/code only: provider messages can echo the prompt.
      console.warn("[ai-structured] call failed", { feature, provider: agentModel ?? step, ...info });
      const { code: errorCode, message } = isSchemaValidationError(err)
        ? { code: "ai_invalid_output" as const, message: "AI returned output that did not match the expected schema after one repair attempt." }
        : agentModel
          ? userFacingAiError(info.kind)
          : { code: "ai_unavailable" as const, message: unavailableMessage(step, ctx.institution.ai_policy) };

      await logUsage({
        ctx,
        feature,
        provider: step,
        model: modelIdFor(step),
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        costEstimateUsd: 0,
        ok: false,
        errorCode,
        redactions,
      });

      lastFailure = { code: errorCode, message };
    } finally {
      releaseConcurrencySlot(ctx.institution.id, step);
    }
  }

  return fail(lastFailure.code, lastFailure.message);
}

// 0140 — the narrow multimodal structured path (study from an uploaded file).
// One file per request, Gemini only (file-input.ts says why), only with the
// role's cloud switch on, within the byte/page caps. The caller fetched the
// bytes server-side through the user's own RLS-checked access; nothing here
// takes a URL. The text prompt and instructions are redacted as usual; the
// file's bytes cannot be (the capability description and the UI say so). No
// fallback: a text-only model would answer without having read the file.
export interface RunStructuredFileInput<T> extends Omit<RunStructuredInput<T>, "agentCloud" | "strictSchema"> {
  file: { bytes: Uint8Array; mime: string; fileName: string };
}

const FILE_TIMEOUT_MS = 90_000;

export async function runStructuredFile<T>(input: RunStructuredFileInput<T>): Promise<ActionResult<RunStructuredOutput<T>>> {
  const { ctx, feature, schema, instructions, prompt, denyNames, maxOutputTokens, permission = "ai.generate", file } = input;
  if (!hasPermission(ctx, permission)) return fail("forbidden", "You do not have permission to use AI features.");

  const gate = fileReadGate({
    geminiKey: configuredCloudKeys().gemini,
    cloudSwitch: roleAiConfig(ctx, ctx.membership.role).cloud,
    mime: file.mime,
    sizeBytes: file.bytes.byteLength,
    pages: file.mime === "application/pdf" ? countPdfPages(file.bytes) : null,
  });
  if (!gate.ok) return fail(gate.code, gate.message);

  const modelId = providers.geminiModelId();
  const failUsage = (errorCode: ErrorCode, latencyMs: number, redactions: number) =>
    logUsage({ ctx, feature, provider: "cloud", model: modelId, inputTokens: 0, outputTokens: 0, latencyMs, costEstimateUsd: 0, ok: false, errorCode, redactions });

  let limits: Awaited<ReturnType<typeof checkLimits>>;
  try {
    limits = await checkLimits(ctx, feature);
  } catch {
    return fail("dependency_failed", "AI usage limits could not be checked; please try again.");
  }
  if (!limits.ok) {
    await failUsage(limits.code, 0, 0);
    return fail(limits.code, limits.code === "quota_exceeded" ? "Today's AI limit is used up. It resets at midnight." : "Too many AI requests; please slow down and try again.");
  }
  if (!acquireConcurrencySlot(ctx.institution.id, "cloud", aiSettingsFor(ctx).max_concurrent_cloud)) {
    return fail("rate_limited", "AI concurrency limit reached; please try again shortly.");
  }

  const startedAt = Date.now();
  let redactions = 0;
  const forCloud = (text: string): string => {
    const redacted = redact(text, denyNames);
    redactions += redacted.count;
    return redacted.text;
  };
  try {
    const { model } = await cloudModelWithFallback("gemini", null);
    const effectiveInstructions = forCloud(instructions);
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: forCloud(prompt) },
          // A neutral name: the real one can carry a student's name or number (07 §5); the gate allows only pdf/jpeg/png.
          { type: "file", data: file.bytes, mediaType: file.mime, filename: `document.${file.mime.split("/")[1]}` },
        ],
      },
    ];
    const attempt = (repairNote?: string) =>
      generateText({
        model,
        instructions: repairNote ? `${effectiveInstructions}\n\n${forCloud(repairNote)}` : effectiveInstructions,
        messages,
        output: Output.object({ schema }),
        timeout: FILE_TIMEOUT_MS,
        maxOutputTokens,
      });
    let result;
    try {
      result = await attempt();
    } catch (err) {
      if (!isSchemaValidationError(err)) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      result = await attempt(`Your previous response was invalid: ${detail}. Return valid JSON that matches the schema exactly, with no extra text.`);
    }
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    await logUsage({
      ctx,
      feature,
      provider: "cloud",
      model: modelId,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - startedAt,
      costEstimateUsd: estimateCost("cloud", modelId, inputTokens, outputTokens),
      ok: true,
      errorCode: null,
      redactions,
    });
    return ok({ data: result.output, provider: "cloud", model: modelId, fallback: false });
  } catch (err) {
    const info = classifyAiError(err);
    console.warn("[ai-structured-file] call failed", { feature, provider: "gemini", ...info });
    const { code, message } = isSchemaValidationError(err)
      ? { code: "ai_invalid_output" as const, message: "The AI could not turn this file into study material. Try another format, or paste the text." }
      : info.kind === "busy"
        ? { code: "rate_limited" as const, message: "The AI service is busy right now. Please try again in a minute." }
        : { code: "ai_unavailable" as const, message: FILE_UNREADABLE_NOW };
    await failUsage(code, Date.now() - startedAt, redactions);
    return fail(code, message);
  } finally {
    releaseConcurrencySlot(ctx.institution.id, "cloud");
  }
}

// Pictures (/image). One picture per request, Gemini only (no other configured
// provider draws), only with the role's cloud switch on: the same owner cloud
// exception as the agentCloud text path. The prompt is redacted like any cloud
// text. Nothing is stored: the caller hands the bytes to the browser. No
// fallback and no retry: a second attempt would bill a second picture.
export interface RunImageInput {
  ctx: TenantContext;
  feature: string;
  /** The whole prompt, the caller's fixed frame included. */
  prompt: string;
  denyNames: string[];
  permission?: Permission;
}

export interface RunImageOutput {
  base64: string;
  mediaType: string;
  provider: "cloud";
  model: string;
}

const IMAGE_TIMEOUT_MS = 60_000;
/** What Gemini bills one picture as (output tokens): counted against the day's quota like any answer. */
const IMAGE_OUTPUT_TOKENS = 1290;
/** Refuse an answer larger than this (base64 characters, about 3 MB of picture): the JSON must fit a 4.5 MB function response. */
const IMAGE_MAX_BASE64 = 4_000_000;

export async function runImage(input: RunImageInput): Promise<ActionResult<RunImageOutput>> {
  const { ctx, feature, prompt, denyNames, permission = "ai.generate" } = input;
  if (!hasPermission(ctx, permission)) return fail("forbidden", "You do not have permission to use AI features.");
  if (!picturesEnabled()) return fail("ai_unavailable", "Pictures are not switched on yet. Try /diagram or /mindmap instead.");
  if (!roleAiConfig(ctx, ctx.membership.role).cloud) {
    return fail("ai_unavailable", "Pictures are drawn by the school's cloud AI provider, which is not switched on for your role.");
  }

  const modelId = providers.geminiImageModelId();
  // `billed`: the provider drew a picture (and charged for it), whether or not it could be used.
  const usage = (billed: boolean, errorCode: ErrorCode | null, latencyMs: number, redactions: number) =>
    logUsage({
      ctx,
      feature,
      provider: "cloud",
      model: modelId,
      inputTokens: billed ? estimateTokens(prompt) : 0,
      outputTokens: billed ? IMAGE_OUTPUT_TOKENS : 0,
      latencyMs,
      costEstimateUsd: billed ? estimateCost("cloud", modelId, estimateTokens(prompt), IMAGE_OUTPUT_TOKENS) : 0,
      ok: errorCode === null,
      errorCode,
      redactions,
    });

  let limits: Awaited<ReturnType<typeof checkLimits>>;
  try {
    limits = await checkLimits(ctx, feature);
  } catch {
    return fail("dependency_failed", "AI usage limits could not be checked; please try again.");
  }
  if (!limits.ok) {
    await usage(false, limits.code, 0, 0);
    return fail(limits.code, limits.code === "quota_exceeded" ? "Today's AI limit is used up. It resets at midnight." : "Too many AI requests; please slow down and try again.");
  }
  if (!acquireConcurrencySlot(ctx.institution.id, "cloud", aiSettingsFor(ctx).max_concurrent_cloud)) {
    return fail("rate_limited", "AI concurrency limit reached; please try again shortly.");
  }

  const startedAt = Date.now();
  const redacted = redact(prompt, denyNames);
  try {
    const result = await generateImage({ model: await providers.getGeminiImageModel(), prompt: redacted.text, n: 1, maxRetries: 0, abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
    const { base64, mediaType } = result.image;
    if (!base64 || base64.length > IMAGE_MAX_BASE64 || !/^image\/(png|jpeg|webp)$/.test(mediaType)) {
      // A picture that came back unusable was still drawn and charged: it counts toward the day's quota.
      await usage(Boolean(base64), "ai_invalid_output", Date.now() - startedAt, redacted.count);
      return fail("ai_invalid_output", "The AI did not send back a picture. Try again, or describe it differently.");
    }
    await usage(true, null, Date.now() - startedAt, redacted.count);
    return ok({ base64, mediaType, provider: "cloud", model: modelId });
  } catch (err) {
    const info = classifyAiError(err);
    // Status/code only: provider messages can echo the prompt.
    console.warn("[ai-image] call failed", { feature, provider: "gemini", ...info });
    const { code, message } =
      info.kind === "busy"
        ? // A 429 here is a spent picture quota as often as a busy minute (a plan without image output answers the same way).
          { code: "rate_limited" as const, message: "The AI provider did not take the picture request: its picture quota is used up or not part of the school's plan. Try /diagram or /mindmap, or try again later." }
        : { code: "ai_unavailable" as const, message: "The picture could not be drawn right now. Try again, or describe it differently." };
    await usage(false, code, Date.now() - startedAt, redacted.count);
    return fail(code, message);
  } finally {
    releaseConcurrencySlot(ctx.institution.id, "cloud");
  }
}

// D31/D32/GU-05 — the streaming counterpart to `runStructured`, for a
// multi-turn tool-calling agent (not a one-shot structured object). Same
// gate order (permission → policy plan → quota → concurrency → provider),
// same usage-logging contract, same never-throws-across-the-boundary
// promise — but a stream, once started, is committed: unlike
// `runStructured`'s per-step retry ladder, there is no fallback to a
// second provider after the first token, because the caller has already
// started forwarding bytes to the client by then. Nothing calls this yet
// (GU-08, wave 2) — D31's teacher agent deliberately stays on its own D28
// route (plan §9: "not recommended now").
//
// Security review (2026-10-31) before the first caller lands: the cloud
// step is disabled unconditionally below (HIGH-2) — a multi-turn
// transcript's tool results are produced mid-stream, after this function
// has handed off, so there is no safe point left to redact them from, and
// `StreamAgentInput` has no `denyNames` yet either. Re-enable it only once
// a real cloud caller needs it, with `prepareStep` redaction over every
// message/tool-result and a `denyNames` input, not before.
export interface StreamAgentInput<TOOLS extends ToolSet> {
  ctx: TenantContext;
  feature: string;
  /** Caller-named, since a future caller may check a permission other than `ai.generate` (e.g. `ai.study`). */
  permission: Permission;
  /**
   * D32 — required, not optional (HIGH-1 fix: an omitted or mistyped
   * value must never silently fall through to the unrestricted "general"
   * path). `"student_personal"` may run only on a `local_only`
   * institution; there is no cloud path for it yet (free-tier terms
   * unsuitable for minors' data, no paid-tier decision made).
   */
  dataClass: "general" | "student_personal";
  system: string;
  messages: ModelMessage[];
  tools: TOOLS;
  stopWhen?: StopCondition<TOOLS> | StopCondition<TOOLS>[];
  maxOutputTokens?: number;
  toolCallConcurrency?: number;
  /** Required (MEDIUM-1 fix): without the request's own abort signal, a disconnected client's generation keeps running and holding a shared concurrency slot. */
  abortSignal: AbortSignal;
  /**
   * GU-08 security review (H1) — defaults to `ctx.institution.id`, same as
   * `runStructured`. A caller whose feature must not share the
   * institution's own concurrency pool (e.g. the student study chat,
   * which would otherwise compete with every teacher's local AI call for
   * the same two slots) passes its own composite key here — same trick
   * the teacher route already uses for its own bucket, just lifted into
   * this shared function instead of being re-invented per caller.
   */
  concurrencyKey?: string;
  /** M22-T4 — links usage rows to the agent run that caused them. */
  agentRunId?: string;
  /** Tool budget hints (tool-budget.ts), same as `streamCloudAgent`'s. */
  budget?: ToolBudgetHints;
}

export type StreamAgentResult<TOOLS extends ToolSet> =
  | ({ ok: true; provider: ProviderStep; modelId: string; stream: ReturnType<typeof streamText<TOOLS>> } & StreamExtras)
  | { ok: false; error: { code: ErrorCode; message: string } };

// MEDIUM-1 fix: a caller-unspecified cap, same default order of magnitude
// as the teacher route's own `MAX_OUTPUT_TOKENS`, so a stream can't run
// unbounded just because a caller forgot to set one.
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

function streamAgentCorrelationId(): string {
  return crypto.randomUUID();
}

export async function streamAgent<TOOLS extends ToolSet>(
  input: StreamAgentInput<TOOLS>,
): Promise<StreamAgentResult<TOOLS>> {
  const { ctx, feature, permission, dataClass, system, messages, tools, stopWhen, toolCallConcurrency, abortSignal } = input;
  const maxOutputTokens = input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const concurrencyKey = input.concurrencyKey ?? ctx.institution.id;
  const agentRunId = input.agentRunId ?? null;

  if (!hasPermission(ctx, permission)) {
    return { ok: false, error: { code: "forbidden", message: "You do not have permission to use AI features." } };
  }

  // D32 — checked before `resolvePlan` even runs: a cloud-policy
  // institution must never reach the cloud provider factory for this
  // data class, not merely be routed away from it. HIGH-1 fix: fails
  // closed on anything other than the literal "general" opt-out, not
  // just on the literal "student_personal" opt-in.
  if (dataClass !== "general" && ctx.institution.ai_policy !== "local_only") {
    return {
      ok: false,
      error: { code: "ai_policy_blocked", message: "This feature is only available on a local-only AI policy for now." },
    };
  }

  const plan = resolvePlan({
    aiPolicy: ctx.institution.ai_policy,
    cloudEnabled: process.env.AI_CLOUD_ENABLED === "true",
    hasCloudKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });

  let limits: Awaited<ReturnType<typeof checkLimits>>;
  try {
    limits = await checkLimits(ctx, feature);
  } catch {
    return { ok: false, error: { code: "dependency_failed", message: "AI usage limits could not be checked; please try again." } };
  }
  if (!limits.ok) {
    await logUsage({
      ctx,
      feature,
      provider: plan[0],
      model: stepModelId(plan[0]),
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      costEstimateUsd: 0,
      ok: false,
      errorCode: limits.code,
      redactions: 0,
      agentRunId,
    });
    const message =
      limits.code === "quota_exceeded"
        ? "Today's AI limit is used up. It resets at midnight."
        : "Too many AI requests; please slow down and try again.";
    return { ok: false, error: { code: limits.code, message } };
  }

  const settings = aiSettingsFor(ctx);

  for (const step of plan) {
    // HIGH-2 fix: the cloud step is categorically refused here, before a
    // concurrency slot is even acquired — see the function's own header
    // comment. This can empty a `["cloud"]`-only plan (`cloud_allowed`
    // with no local), which is the correct outcome (`ai_unavailable`),
    // not a silent drop to an unredacted call.
    if (step === "cloud") continue;

    const concurrencyLimit = settings.max_concurrent_local;
    if (!acquireConcurrencySlot(concurrencyKey, step, concurrencyLimit)) {
      continue; // try the next step in the plan, same as runStructured
    }

    const modelId = stepModelId(step);
    try {
      // Cloud provider module is never imported in this function today
      // (HIGH-2) — kept as a named step in `plan` only so a future,
      // reviewed cloud path can be re-enabled by removing the guard
      // above, not by restructuring this loop.
      const model = providers.getLocalModel();
      // `step` is always `"local"` here (the cloud guard above `continue`s
      // before this point) — no redaction needed; local data never
      // leaves the school's own server. Kept as its own variable, not a
      // hardcoded 0, so re-enabling the cloud step later is a matter of
      // restoring `redact(system)` on that branch, not rediscovering
      // that `redactions` was ever meant to reflect something real
      // (LOW-2: it was hardcoded 0 even while cloud redaction happened).
      const redacted = { text: system, count: 0 };

      const startedAt = Date.now();
      const accumulatedUsage = { inputTokens: 0, outputTokens: 0 };
      const plan = planToolBudget({ texts: [], ...input.budget, system: redacted.text, messages, tools, ceiling: TOKEN_CEILING.local });
      const logContext = { feature, provider: "local", estimatedTokens: plan.estimatedTokens };
      console.info("[ai-budget]", { ...logContext, tools: plan.activeTools.length, groups: plan.groups.slice(0, 6) });
      const stream = streamText({
        model,
        system: redacted.text,
        messages: plan.messages,
        tools: tolerateNullOptionals(plan.tools),
        activeTools: plan.activeTools,
        prepareStep: plan.prepareStep,
        stopWhen,
        maxOutputTokens,
        toolCallConcurrency,
        abortSignal,
        timeout: TIMEOUT_MS[step],
        onError: ({ error }) => {
          const correlationId = streamAgentCorrelationId();
          console.error(`[${correlationId}] streamAgent step failed`, { ...logContext, ...classifyAiError(error) });
        },
        onStepFinish: (streamStep) => {
          accumulatedUsage.inputTokens += streamStep.usage.inputTokens ?? 0;
          accumulatedUsage.outputTokens += streamStep.usage.outputTokens ?? 0;
        },
      });

      Promise.resolve(stream.totalUsage)
        .then((usage) =>
          logUsage({
            ctx,
            feature,
            provider: step,
            model: modelId,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            latencyMs: Date.now() - startedAt,
            costEstimateUsd: estimateCost(step, modelId, usage.inputTokens ?? 0, usage.outputTokens ?? 0),
            ok: true,
            errorCode: null,
            redactions: redacted.count,
            agentRunId,
          }),
        )
        .catch(() =>
          logUsage({
            ctx,
            feature,
            provider: step,
            model: modelId,
            inputTokens: accumulatedUsage.inputTokens,
            outputTokens: accumulatedUsage.outputTokens,
            latencyMs: Date.now() - startedAt,
            costEstimateUsd: estimateCost(step, modelId, accumulatedUsage.inputTokens, accumulatedUsage.outputTokens),
            ok: false,
            errorCode: "ai_unavailable",
            redactions: redacted.count,
            agentRunId,
          }),
        )
        .finally(() => releaseConcurrencySlot(concurrencyKey, step));

      return {
        ok: true,
        provider: step,
        modelId,
        stream,
        estimatedTokens: plan.estimatedTokens,
        errorText: (error: unknown) => streamErrorText(error),
      };
    } catch {
      // Setup failed before any token streamed (e.g. provider not
      // configured) — safe to try the next step, per this function's own
      // "fallback only before the first token" rule.
      releaseConcurrencySlot(concurrencyKey, step);
      continue;
    }
  }

  return {
    ok: false,
    error: { code: "ai_unavailable", message: unavailableMessage(plan[0], ctx.institution.ai_policy) },
  };
}

// T3a (ai-roles rule 6) — the single entry point a chat caller (T4's
// handleAiChat) uses for either path, instead of calling streamAgent or
// streamCloudAgent directly. `mode` is caller-decided (role AI config +
// provider keys, resolved by the caller, not this function): `"local"`
// delegates to `streamAgent` unchanged, which never touches a cloud
// provider factory. `"cloud"` delegates to `streamCloudAgent`
// (lib/ai/cloud-stream.ts) with every tool's `execute` result redacted
// first (07 §5) — a cloud step has a safe per-tool-call point to redact
// from, unlike `streamAgent`'s own whole, already-committed transcript
// (see that function's header comment).
export interface StreamChatInput<TOOLS extends ToolSet> {
  ctx: TenantContext;
  feature: string;
  permission: Permission;
  dataClass: "general" | "student_personal";
  mode: "local" | "cloud";
  /** Required when `mode` is `"cloud"`. */
  provider?: AgentProvider;
  system: string;
  messages: ModelMessage[];
  tools: TOOLS;
  stopWhen?: StopCondition<TOOLS> | StopCondition<TOOLS>[];
  maxOutputTokens?: number;
  concurrencyKey?: string;
  abortSignal: AbortSignal;
  /** Redactions already applied by the caller (e.g. to `messages`) before this call; tool-result redactions on the cloud path are added on top. */
  redactions?: number;
  /** Required when `mode` is `"cloud"`: shown to the caller if that provider has no key configured. */
  notConfiguredMessage?: string;
  /** Tool budget hints (tool-budget.ts): groups to pick from, tools always kept, latest user text first. */
  budget?: ToolBudgetHints;
}

export type StreamChatResult<TOOLS extends ToolSet> =
  | ({ ok: true; provider: ProviderStep; modelId: string; stream: ReturnType<typeof streamText<TOOLS>> } & StreamExtras)
  | { ok: false; error: { code: ErrorCode; message: string } };

// Redacts every string leaf, keeping the value's shape: structured tool
// output (e.g. the student's study blocks) is rendered by the UI from its
// object form, so it must not be stringified.
function redactDeep(value: unknown, tally: { count: number }): unknown {
  if (typeof value === "string") {
    const redacted = redact(value);
    tally.count += redacted.count;
    return redacted.text;
  }
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, tally));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, tally)]));
  }
  return value;
}

// Wraps every tool with an `execute` so its result is redacted before it
// can reach a cloud provider; the count folds into `tally` so
// `streamCloudAgent`'s usage log (read lazily via its `redactions` thunk)
// reflects it.
export function redactToolResults<TOOLS extends ToolSet>(tools: TOOLS, tally: { count: number }): TOOLS {
  const wrapped: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(tools)) {
    const execute = (tool as { execute?: (...args: unknown[]) => unknown }).execute;
    if (typeof execute !== "function") {
      wrapped[name] = tool;
      continue;
    }
    // A tool with toModelOutput sends the model only that (orb task cards: ids and
    // names go to the browser, never the model), so redact what the model gets and
    // leave the browser's copy intact (redacting it corrupted ids with 12-digit runs).
    const toModelOutput = (tool as { toModelOutput?: (options: unknown) => unknown }).toModelOutput;
    if (typeof toModelOutput === "function") {
      wrapped[name] = { ...tool, toModelOutput: async (options: unknown) => redactDeep(await toModelOutput(options), tally) };
      continue;
    }
    wrapped[name] = {
      ...tool,
      execute: async (...args: unknown[]) => redactDeep(await execute(...args), tally),
    };
  }
  return wrapped as TOOLS;
}

export async function streamChat<TOOLS extends ToolSet>(
  input: StreamChatInput<TOOLS>,
): Promise<StreamChatResult<TOOLS>> {
  const { ctx, feature, permission, dataClass, mode, system, messages, tools, stopWhen, maxOutputTokens, concurrencyKey, abortSignal } =
    input;

  if (!hasPermission(ctx, permission)) {
    return { ok: false, error: { code: "forbidden", message: "You do not have permission to use AI features." } };
  }

  if (mode === "local") {
    return streamAgent({ ctx, feature, permission, dataClass, system, messages, tools, stopWhen, maxOutputTokens, concurrencyKey, abortSignal, budget: input.budget });
  }

  if (!input.provider) {
    return { ok: false, error: { code: "ai_unavailable", message: "No cloud AI provider configured for this request." } };
  }

  const tally = { count: input.redactions ?? 0 };
  const result = await streamCloudAgent({
    ctx,
    feature,
    provider: input.provider,
    system,
    messages,
    tools: redactToolResults(tools, tally),
    abortSignal,
    redactions: () => tally.count,
    notConfiguredMessage: input.notConfiguredMessage ?? "Cloud AI provider is not configured.",
    budget: input.budget,
  });

  if (!result.ok) return result;
  return { ...result, provider: "cloud" };
}
