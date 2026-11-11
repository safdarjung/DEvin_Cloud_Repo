// Provider fallback + honest errors (src/lib/ai/provider-fallback.ts): a
// Groq size/rate error retries once on Gemini (only with its key), a local
// request never reaches a cloud provider, and the browser only ever sees a
// category message.
import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError, RetryError, streamText } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { chatErrorMessage } from "@/modules/ai/chat-error";

const groqModel = { current: null as MockLanguageModelV4 | null };
const geminiModel = { current: null as MockLanguageModelV4 | null };
const zaiModel = { current: null as MockLanguageModelV4 | null };

vi.mock("@/lib/ai/providers", () => ({
  groqModelId: () => "openai/gpt-oss-120b",
  geminiModelId: () => "gemini-flash-lite-latest",
  zaiModelId: () => "glm-4.7-flash",
  getGroqModel: vi.fn(async () => groqModel.current),
  getGeminiModel: vi.fn(async () => geminiModel.current),
  getZaiModel: vi.fn(async () => zaiModel.current),
}));

const { classifyAiError, cloudModelWithFallback, cloudProviderPlan, shouldFallback, streamErrorText, userFacingAiError } = await import(
  "@/lib/ai/provider-fallback"
);
const providers = await import("@/lib/ai/providers");

afterEach(() => {
  vi.restoreAllMocks();
  groqModel.current = null;
  geminiModel.current = null;
  zaiModel.current = null;
});

const SECRET = "org_01secret Limit 8000, Requested 12945";

function apiError(statusCode: number, responseBody = `{"error":{"message":"${SECRET}","code":"rate_limit_exceeded"}}`): APICallError {
  return new APICallError({ message: `provider said: ${SECRET}`, url: "https://x", requestBodyValues: {}, statusCode, responseBody });
}

describe("classifyAiError / shouldFallback", () => {
  it.each([
    [413, "too_large", true],
    [429, "busy", true],
    [500, "busy", true],
    [503, "busy", true],
    [401, "not_configured", false],
    [403, "not_configured", false],
    [404, "not_configured", false],
  ] as const)("HTTP %i -> %s (fallback %s)", (status, kind, fallback) => {
    const body = status === 413 || status === 429 ? undefined : `{"error":{"message":"nope"}}`;
    expect(classifyAiError(apiError(status, body)).kind).toBe(kind);
    expect(shouldFallback(apiError(status, body))).toBe(fallback);
  });

  it("reads Groq's 'Request too large' TPM error as too large, and a context-length 400 too", () => {
    expect(classifyAiError(apiError(400, '{"error":{"message":"Request too large for model","code":"request_too_large"}}')).kind).toBe("too_large");
    expect(classifyAiError(apiError(400, '{"error":{"code":"context_length_exceeded"}}')).kind).toBe("too_large");
  });

  it("unwraps the SDK's retry error and keeps the provider code for the log", () => {
    const wrapped = new RetryError({ message: "retries", reason: "maxRetriesExceeded", errors: [apiError(429)] });
    expect(classifyAiError(wrapped)).toEqual({ kind: "busy", status: 429, providerCode: "rate_limit_exceeded" });
  });

  it("a plain error is generic and never triggers a fallback", () => {
    expect(classifyAiError(new Error("boom")).kind).toBe("unavailable");
    expect(shouldFallback(new Error("boom"))).toBe(false);
  });
});

describe("cloudProviderPlan (fallback decision table)", () => {
  const both = { groq: true, gemini: true, zai: false };
  const all = { groq: true, gemini: true, zai: true };
  it.each([
    ["local mode never names a cloud provider, keys or not", { mode: "local", preferred: "groq", keys: both }, null],
    ["gemini first whatever the old routing pick, groq the retry when the request fits groq", { mode: "cloud", preferred: "groq", keys: both, requestTokens: 5_500 }, { primary: "gemini", fallback: "groq" }],
    ["gemini first, a request above groq's ceiling gets no groq retry", { mode: "cloud", preferred: "gemini", keys: both, requestTokens: 5_501 }, { primary: "gemini", fallback: null }],
    ["no gemini key: groq answers, no fallback", { mode: "cloud", preferred: "groq", keys: { groq: true, gemini: false, zai: false } }, { primary: "groq", fallback: null }],
    ["no groq key: gemini answers, no fallback", { mode: "cloud", preferred: "groq", keys: { groq: false, gemini: true, zai: false } }, { primary: "gemini", fallback: null }],
    ["no keys: no cloud", { mode: "cloud", preferred: "gemini", keys: { groq: false, gemini: false, zai: false } }, null],
    ["local mode never names a cloud provider, Z.ai key or not", { mode: "local", preferred: "groq", keys: all, requestTokens: 100 }, null],
    ["all keyed: gemini first, groq the retry when it fits, zai the second backup", { mode: "cloud", preferred: "gemini", keys: all, requestTokens: 5_500 }, { primary: "gemini", fallback: "groq", last: "zai" }],
    ["all keyed: a request above groq's ceiling skips groq and retries on zai", { mode: "cloud", preferred: "groq", keys: all, requestTokens: 5_501 }, { primary: "gemini", fallback: "zai" }],
    ["all keyed, request size unknown: never groq", { mode: "cloud", preferred: "groq", keys: all }, { primary: "gemini", fallback: "zai" }],
    ["no gemini key: groq first with zai as its backup", { mode: "cloud", preferred: "groq", keys: { groq: true, gemini: false, zai: true }, requestTokens: 6_000 }, { primary: "groq", fallback: "zai" }],
    ["only a zai key: zai, no retry", { mode: "cloud", preferred: "groq", keys: { groq: false, gemini: false, zai: true }, requestTokens: 100 }, { primary: "zai", fallback: null }],
  ] as const)("%s", (_name, input, expected) => {
    expect(cloudProviderPlan(input)).toEqual(expected);
  });
});

describe("streamErrorText (what the chat UIs render)", () => {
  it("separates busy, too-much-data and generic failures, as an envelope chatErrorMessage reads", () => {
    const busy = streamErrorText(apiError(429));
    expect(JSON.parse(busy)).toEqual({ ok: false, error: { code: "rate_limited", message: userFacingAiError("busy").message } });
    expect(chatErrorMessage(new Error(busy))).toMatch(/busy.*try again in a minute/i);
    expect(chatErrorMessage(new Error(streamErrorText(apiError(413))))).toMatch(/needs more school data/i);
    expect(chatErrorMessage(new Error(streamErrorText(new Error("boom"))))).toMatch(/could not answer right now/i);
  });

  it("never carries provider text, org ids or numbers from the provider", () => {
    for (const status of [400, 401, 413, 429, 500]) {
      const text = streamErrorText(apiError(status));
      expect(text).not.toMatch(/org_|secret|8000|12945|provider said/);
    }
  });
});

// ---- the wrapped model, end to end through streamText ----------------------

const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

function answering(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: text },
        { type: "text-end", id: "t" },
        { type: "finish", usage: USAGE, finishReason: { unified: "stop", raw: undefined } },
      ] as never),
    }),
  });
}

function failing(error: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw error;
    },
  });
}

async function answer(primary: "groq" | "gemini" | "zai", fallback: "groq" | "gemini" | null) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const cloud = await cloudModelWithFallback(primary, fallback);
  const result = streamText({ model: cloud.model, prompt: "hi", maxRetries: 0, onError: () => {} });
  const text = await result.text.then(
    (t) => t,
    () => "<error>",
  );
  return { text, used: cloud.modelsUsed() };
}

describe("cloudModelWithFallback", () => {
  it("a Groq 413 (request too large) is answered by Gemini and logged as Gemini", async () => {
    groqModel.current = failing(apiError(413));
    geminiModel.current = answering("from gemini");
    expect(await answer("groq", "gemini")).toEqual({ text: "from gemini", used: ["gemini-flash-lite-latest"] });
  });

  it("a healthy primary never builds the fallback model", async () => {
    groqModel.current = answering("from groq");
    expect(await answer("groq", "gemini")).toEqual({ text: "from groq", used: ["openai/gpt-oss-120b"] });
    expect(providers.getGeminiModel).not.toHaveBeenCalled();
  });

  it("a Z.ai 429 (no balance, or the free model overloaded) is answered by Groq and logged as Groq", async () => {
    zaiModel.current = failing(apiError(429, '{"error":{"code":"1113","message":"Insufficient balance"}}'));
    groqModel.current = answering("from groq");
    expect(await answer("zai", "groq")).toEqual({ text: "from groq", used: ["openai/gpt-oss-120b"] });
  });

  it("a healthy Z.ai answers and is logged with its model id", async () => {
    zaiModel.current = answering("from zai");
    expect(await answer("zai", "groq")).toEqual({ text: "from zai", used: ["glm-4.7-flash"] });
    expect(providers.getGroqModel).not.toHaveBeenCalled();
  });

  it("no fallback configured: the error stands", async () => {
    groqModel.current = failing(apiError(429));
    expect((await answer("groq", null)).text).toBe("<error>");
  });

  it("a rejected key (401) is not retried on the other provider", async () => {
    groqModel.current = failing(apiError(401));
    geminiModel.current = answering("should not happen");
    expect((await answer("groq", "gemini")).text).toBe("<error>");
  });
});

describe("chat text helpers (what the chat UIs render)", async () => {
  const { lastHasText, navigateLink, plainChatText, sourceLabel } = await import("@/modules/ai/chat-text");

  it("strips Markdown bold and heading marks the UIs would show raw", () => {
    expect(plainChatText("## Fees\n**Grade IX** owes ₹13,358 * 2 rows")).toBe("Fees\nGrade IX owes ₹13,358 * 2 rows");
    expect(plainChatText("See the [Attendance page](/attendance) or call `getAttendancePattern`.")).toBe("See the Attendance page or call getAttendancePattern.");
  });

  it("only turns a finished navigate call with an in-app path into a link", () => {
    const part = { type: "tool-navigate", state: "output-available", output: { href: "/demo/fees", label: "Fees" } };
    expect(navigateLink(part)).toEqual({ href: "/demo/fees", label: "Fees" });
    expect(navigateLink({ ...part, output: { href: "//evil.example", label: "x" } })).toBeNull();
    expect(navigateLink({ ...part, state: "input-available" })).toBeNull();
  });

  it("names records by description and keeps the thinking line until text arrives", () => {
    expect(sourceLabel("finance.termCollectionSummary")).toBe("Fee collection summary for a term");
    expect(sourceLabel("unknown.query")).toBe("unknown.query");
    expect(lastHasText([{ role: "user", parts: [{ type: "text", text: "q" }] }])).toBe(false);
    expect(lastHasText([{ role: "assistant", parts: [{ type: "reasoning", text: "…" }] }])).toBe(false);
    expect(lastHasText([{ role: "assistant", parts: [{ type: "text", text: "A" }] }])).toBe(true);
  });
});

describe("cloudModelWithFallback with a last resort", () => {
  it("Z.ai busy and Groq out of quota: Gemini answers and is the model logged", async () => {
    zaiModel.current = failing(apiError(429));
    groqModel.current = failing(apiError(429));
    geminiModel.current = answering("from gemini");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cloud = await cloudModelWithFallback("zai", "groq", "gemini");
    const result = streamText({ model: cloud.model, prompt: "hi", maxRetries: 0, onError: () => {} });
    expect(await result.text).toBe("from gemini");
    expect(cloud.modelsUsed()).toEqual(["gemini-flash-lite-latest"]);
    expect(warn.mock.calls.map((c) => (c[1] as { from: string; to: string }).from + ">" + (c[1] as { to: string }).to)).toEqual(["zai>groq", "groq>gemini"]);
  });

  it("a provider that hangs is left after the attempt limit and the next one answers", async () => {
    vi.useFakeTimers();
    try {
      zaiModel.current = new MockLanguageModelV4({ doStream: () => new Promise(() => {}) });
      groqModel.current = answering("from groq");
      geminiModel.current = answering("from gemini");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const cloud = await cloudModelWithFallback("zai", "groq", "gemini");
      const m = cloud.model as unknown as { doStream: (p: unknown) => PromiseLike<unknown> };
      const pending = m.doStream({ prompt: [] });
      await vi.advanceTimersByTimeAsync(12_000);
      await pending;
      expect(cloud.modelsUsed()).toEqual(["openai/gpt-oss-120b"]);
      expect((warn.mock.calls[0][1] as { kind: string }).kind).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an error that is not size or rate on the fallback stops the chain", async () => {
    zaiModel.current = failing(apiError(429));
    groqModel.current = failing(apiError(401));
    geminiModel.current = answering("from gemini");
    const { text } = await answerChain();
    expect(text).toBe("<error>");
  });
});

async function answerChain() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const cloud = await cloudModelWithFallback("zai", "groq", "gemini");
  const result = streamText({ model: cloud.model, prompt: "hi", maxRetries: 0, onError: () => {} });
  const text = await result.text.then(
    (t) => t,
    () => "<error>",
  );
  return { text };
}

describe("cloudModelWithFallback across steps", () => {
  it("after one fallback, later steps of the same request go straight to the fallback", async () => {
    let groqCalls = 0;
    groqModel.current = new MockLanguageModelV4({
      doStream: async () => {
        groqCalls += 1;
        throw apiError(429);
      },
    });
    geminiModel.current = answering("from gemini");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cloud = await cloudModelWithFallback("groq", "gemini");
    const m = cloud.model as unknown as { doStream: (p: unknown) => PromiseLike<unknown> };
    await m.doStream({ prompt: [] });
    await m.doStream({ prompt: [] });
    expect(groqCalls).toBe(1);
    expect(cloud.modelsUsed()).toEqual(["gemini-flash-lite-latest"]);
  });
});
