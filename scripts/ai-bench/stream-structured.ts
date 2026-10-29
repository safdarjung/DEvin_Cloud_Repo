// T-040 — shared streaming + timing helper used by both tasks/quiz.ts and
// tasks/summary.ts. Confirmed against the installed ai@7.0.155 .d.ts
// (node_modules/.pnpm/ai@7.0.155.../dist/index.d.ts):
//   - `streamObject({ model, schema, prompt, temperature, seed,
//     maxOutputTokens, abortSignal })` — all top-level LanguageModelCallOptions
//     / RequestOptions fields, no `Output.object` wrapper needed since
//     streamObject already returns a schema-typed result.
//   - `result.fullStream` yields `{ type: 'text-delta', textDelta }` parts;
//     the first one is this run's TTFT.
//   - `result.usage` resolves to `{ inputTokens, outputTokens, ... }`
//     (both `number | undefined`).
//   - `result.finishReason` resolves to one of 'stop' | 'length' |
//     'content-filter' | 'tool-calls' | 'error' | 'interrupted' | 'other'.
//   - `result.object` resolves to the schema-validated object, or rejects
//     (TypeValidationError) if validation never succeeds — used here as the
//     "after repair" check, since the provider's own reliability layer
//     (ai-sdk-ollama's `reliableObjectGeneration`, default on) runs before
//     this promise settles.
import { streamObject, type LanguageModel } from "ai";
import type { ZodType } from "zod";

export interface StreamStructuredOptions {
  model: LanguageModel;
  prompt: string;
  schema: ZodType;
  temperature: number;
  seed?: number;
  maxOutputTokens: number;
  abortSignal: AbortSignal;
}

export interface StreamStructuredResult {
  ttftMs: number | null;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  rawText: string;
  object: unknown;
  jsonParseOk: boolean;
  schemaOkFirst: boolean;
  schemaOkAfterRepair: boolean;
  finishReason: string;
  timedOut: boolean;
  httpError: boolean;
}

export async function streamStructured(opts: StreamStructuredOptions): Promise<StreamStructuredResult> {
  const start = performance.now();
  let ttftMs: number | null = null;
  let rawText = "";

  try {
    const result = streamObject({
      model: opts.model,
      schema: opts.schema,
      prompt: opts.prompt,
      temperature: opts.temperature,
      seed: opts.seed,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.abortSignal,
    });

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        if (ttftMs === null) ttftMs = performance.now() - start;
        rawText += part.textDelta;
      }
    }

    const [usage, finishReason] = await Promise.all([result.usage, result.finishReason]);
    const totalMs = performance.now() - start;

    let jsonParseOk = true;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      jsonParseOk = false;
    }

    const schemaOkFirst = jsonParseOk && opts.schema.safeParse(parsed).success;

    let object: unknown = schemaOkFirst ? parsed : undefined;
    let schemaOkAfterRepair = schemaOkFirst;
    if (!schemaOkFirst) {
      try {
        object = await result.object;
        schemaOkAfterRepair = true;
      } catch {
        schemaOkAfterRepair = false;
      }
    }

    return {
      ttftMs,
      totalMs,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      rawText,
      object,
      jsonParseOk,
      schemaOkFirst,
      schemaOkAfterRepair,
      finishReason,
      timedOut: false,
      httpError: false,
    };
  } catch (err) {
    const totalMs = performance.now() - start;
    const isAbort = err instanceof Error && (err.name === "AbortError" || opts.abortSignal.aborted);
    return {
      ttftMs,
      totalMs,
      inputTokens: 0,
      outputTokens: 0,
      rawText,
      object: undefined,
      jsonParseOk: false,
      schemaOkFirst: false,
      schemaOkAfterRepair: false,
      finishReason: "error",
      timedOut: isAbort,
      httpError: !isAbort,
    };
  }
}
