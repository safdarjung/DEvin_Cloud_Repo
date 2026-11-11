// One-shot structured AI calls on the cloud path (runStructured): which
// provider takes a request of a given size, the Gemini schema sanitiser on
// the wire, and the two regressions behind "AI tools not working" on a
// cloud-only host (routes that never opted into the cloud path; task
// capabilities offered to roles the gateway then refuses).
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError, generateText, Output, type JSONSchema7 } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { hasPermission } from "@/lib/auth/permissions";
import { CAPABILITIES } from "@/modules/ai/capabilities/catalog";

const groqModel = { current: null as MockLanguageModelV4 | null };
const geminiModel = { current: null as MockLanguageModelV4 | null };

vi.mock("@/lib/ai/providers", () => ({
  groqModelId: () => "openai/gpt-oss-120b",
  geminiModelId: () => "gemini-flash-lite-latest",
  getGroqModel: vi.fn(async () => groqModel.current),
  getGeminiModel: vi.fn(async () => geminiModel.current),
}));

const { cloudModelWithFallback, sanitizeSchemaFor, structuredCloudPlan } = await import("@/lib/ai/provider-fallback");

afterEach(() => {
  groqModel.current = null;
  geminiModel.current = null;
});

describe("structuredCloudPlan", () => {
  const both = { groq: true, gemini: true };

  it("no Groq/Gemini key: no cloud plan (the caller keeps the policy plan)", () => {
    expect(structuredCloudPlan({ groq: false, gemini: false }, 100)).toBeNull();
  });

  it("a request that fits Groq runs there with Gemini as its retry", () => {
    expect(structuredCloudPlan(both, 5_500)).toEqual({ primary: "groq", fallback: "gemini" });
  });

  it("a request over Groq's ceiling goes straight to Gemini, with no retry on Groq", () => {
    expect(structuredCloudPlan(both, 5_501)).toEqual({ primary: "gemini", fallback: null });
  });

  it("too big for every keyed provider: too_large, never a silently trimmed prompt", () => {
    expect(structuredCloudPlan({ groq: true, gemini: false }, 6_000)).toBe("too_large");
    expect(structuredCloudPlan(both, 24_001)).toBe("too_large");
  });

  it("only a Gemini key: Gemini, no retry", () => {
    expect(structuredCloudPlan({ groq: false, gemini: true }, 100)).toEqual({ primary: "gemini", fallback: null });
  });
});

describe("sanitizeSchemaFor", () => {
  const schema = {
    type: "object",
    properties: {
      maxItems: { type: "integer", maximum: 5 },
      blocks: { type: "array", minItems: 1, maxItems: 12, items: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 10 } },
    },
    required: ["maxItems", "blocks"],
    additionalProperties: false,
  } as JSONSchema7;

  it("gemini: drops maxItems at every depth, keeps minItems, maxLength and a field named maxItems", () => {
    const out = sanitizeSchemaFor("gemini", schema);
    expect(JSON.stringify(out)).not.toMatch(/"maxItems":\d/);
    expect(out.properties).toHaveProperty("maxItems");
    expect(out.required).toEqual(["maxItems", "blocks"]);
    expect(JSON.stringify(out)).toContain('"minItems":1');
    expect(JSON.stringify(out)).toContain('"maxLength":80');
  });

  it("groq: the schema goes unchanged", () => {
    expect(sanitizeSchemaFor("groq", schema)).toBe(schema);
  });
});

describe("schema on the wire (cloudModelWithFallback)", () => {
  const Schema = z.object({ items: z.array(z.string()).max(3) });

  function capturing(): { model: MockLanguageModelV4; sent: () => unknown } {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: '{"items":["a"]}' }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }),
    });
    return { model, sent: () => (model.doGenerateCalls[0]?.responseFormat as { schema?: unknown } | undefined)?.schema };
  }

  it("Gemini receives the schema without maxItems; Zod still enforces the bound on the output", async () => {
    const gemini = capturing();
    geminiModel.current = gemini.model;
    const cloud = await cloudModelWithFallback("gemini", null);
    const result = await generateText({ model: cloud.model, prompt: "x", output: Output.object({ schema: Schema }) });
    expect(result.output).toEqual({ items: ["a"] });
    expect(JSON.stringify(gemini.sent())).not.toContain("maxItems");
  });

  it("a busy Groq hands the request to Gemini, which still gets the sanitised schema", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    groqModel.current = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: "busy", url: "https://x", requestBodyValues: {}, statusCode: 429 });
      },
    });
    const gemini = capturing();
    geminiModel.current = gemini.model;
    const cloud = await cloudModelWithFallback("groq", "gemini");
    const result = await generateText({ model: cloud.model, prompt: "x", output: Output.object({ schema: Schema }), maxRetries: 0 });
    expect(result.output).toEqual({ items: ["a"] });
    expect(cloud.modelsUsed()).toEqual(["gemini-flash-lite-latest"]);
    expect(JSON.stringify(gemini.sent())).not.toContain("maxItems");
  });

  it("Groq receives the schema as written", async () => {
    const groq = capturing();
    groqModel.current = groq.model;
    const cloud = await cloudModelWithFallback("groq", null);
    await generateText({ model: cloud.model, prompt: "x", output: Output.object({ schema: Schema }) });
    expect(JSON.stringify(groq.sent())).toContain('"maxItems":3');
  });
});

describe("regressions: AI tools on a cloud-only host", () => {
  it("every /api/ai route that calls runStructured opts into the cloud path (else it needs a local engine hosted installs lack)", () => {
    const root = path.join(process.cwd(), "src/app/api/ai");
    const routes = fs
      .readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith("route.ts"))
      .map((file) => ({ file, source: fs.readFileSync(path.join(root, file), "utf8") }))
      .filter(({ source }) => source.includes("runStructured({"));
    expect(routes.length).toBeGreaterThan(15);
    expect(routes.filter(({ source }) => !source.includes("agentCloud: true")).map(({ file }) => file)).toEqual([]);
  });

  it("quiz routes hand QuizContentSchema to the gateway, so a duplicate option or stray answer gets the repair retry", () => {
    for (const route of ["quiz", "practice-quiz"]) {
      expect(fs.readFileSync(path.join(process.cwd(), "src/app/api/ai", route, "route.ts"), "utf8")).toContain("strictSchema: QuizContentSchema");
    }
  });

  it("a task capability is only offered to roles the gateway lets through (ai.generate, or ai.study for student tasks)", () => {
    const refused = Object.values(CAPABILITIES)
      .filter((cap) => cap.kind === "task")
      .flatMap((cap) => cap.roles.filter((role) => !hasPermission(role, cap.permission === "ai.study" ? "ai.study" : "ai.generate")).map((role) => `${cap.key}:${role}`));
    expect(refused).toEqual([]);
  });
});
