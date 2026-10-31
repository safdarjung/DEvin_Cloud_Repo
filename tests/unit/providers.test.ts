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
