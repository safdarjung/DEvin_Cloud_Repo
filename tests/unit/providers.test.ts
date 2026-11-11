// DBT-36 partial fix (GU-08 security review, M3) — getLocalModel refuses
// an Ollama `*-cloud` model tag (runs on ollama.com, not locally).
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("ai-sdk-ollama", () => ({ createOllama: vi.fn(() => () => "local-model-handle") }));

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("getLocalModel", () => {
  it("throws when OLLAMA_MODEL is a *-cloud tag", async () => {
    process.env.OLLAMA_MODEL = "qwen3:4b-cloud";
    const { getLocalModel } = await import("@/lib/ai/providers");
    expect(() => getLocalModel()).toThrow(/cloud/i);
  });

  it("succeeds for an ordinary local model id", async () => {
    process.env.OLLAMA_MODEL = "qwen3:4b-instruct-2507-q4_K_M";
    const { getLocalModel } = await import("@/lib/ai/providers");
    expect(() => getLocalModel()).not.toThrow();
  });
});

describe("getZaiModel", () => {
  // The request body Z.ai receives, captured from a stubbed fetch: no network.
  async function sentBody(model?: string): Promise<Record<string, unknown>> {
    process.env.ZAI_API_KEY = "test-key";
    if (model) process.env.ZAI_MODEL = model;
    else delete process.env.ZAI_MODEL;
    let body: Record<string, unknown> = {};
    let url = "";
    vi.stubGlobal("fetch", vi.fn(async (input: string, init: { body: string }) => {
      url = String(input);
      body = JSON.parse(init.body) as Record<string, unknown>;
      const reply = { id: "1", created: 0, model: "m", choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] };
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const { generateText } = await import("ai");
    const { getZaiModel } = await import("@/lib/ai/providers");
    await generateText({ model: await getZaiModel(), prompt: "hi", maxRetries: 0 });
    vi.unstubAllGlobals();
    expect(url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
    return body;
  }

  it("throws without ZAI_API_KEY", async () => {
    delete process.env.ZAI_API_KEY;
    const { getZaiModel } = await import("@/lib/ai/providers");
    await expect(getZaiModel()).rejects.toThrow(/ZAI_API_KEY/);
  });

  it("defaults to the free glm-4.7-flash with thinking switched off", async () => {
    const body = await sentBody();
    expect(body).toMatchObject({ model: "glm-4.7-flash", thinking: { type: "disabled" } });
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("glm-5.3* cannot switch thinking off: low reasoning effort instead", async () => {
    const body = await sentBody("glm-5.3-flash");
    expect(body).toMatchObject({ model: "glm-5.3-flash", reasoning_effort: "low" });
    expect(body).not.toHaveProperty("thinking");
  });
});
