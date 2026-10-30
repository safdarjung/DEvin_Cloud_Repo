import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => {
    throw new Error("must not be reached for a cross-site request");
  }),
}));
vi.mock("@/lib/auth/context", () => ({
  getTenantContext: vi.fn(() => {
    throw new Error("must not be reached for a cross-site request");
  }),
}));

import { isCrossSiteRequest, readJsonBody } from "@/lib/http/request";
import { POST as quizPost } from "@/app/api/ai/quiz/route";

// DBT-29 (T-042): central body-size cap + Origin check for cookie-authenticated,
// cost-bearing route handlers.
function post(url: string, headers: Record<string, string>, body = "{}"): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}

describe("readJsonBody", () => {
  it("parses a small JSON body", async () => {
    await expect(readJsonBody(post("http://localhost/x", {}, '{"a":1}'), 64)).resolves.toEqual({ ok: true, data: { a: 1 } });
  });

  it("rejects by declared content-length before reading", async () => {
    const req = post("http://localhost/x", { "content-length": "999" }, "{}");
    await expect(readJsonBody(req, 64)).resolves.toEqual({ ok: false, tooLarge: true });
  });

  it("rejects by actual streamed size when the header lies or is absent", async () => {
    const req = post("http://localhost/x", {}, JSON.stringify({ pad: "x".repeat(200) }));
    await expect(readJsonBody(req, 64)).resolves.toEqual({ ok: false, tooLarge: true });
  });

  it("reports malformed JSON as not-too-large", async () => {
    await expect(readJsonBody(post("http://localhost/x", {}, "{nope"), 64)).resolves.toEqual({ ok: false, tooLarge: false });
  });
});

describe("isCrossSiteRequest", () => {
  it("same-origin Origin header is allowed", () => {
    expect(isCrossSiteRequest(post("http://localhost:3000/api/ai/quiz", { origin: "http://localhost:3000" }))).toBe(false);
  });

  it("foreign Origin header is cross-site", () => {
    expect(isCrossSiteRequest(post("http://localhost:3000/api/ai/quiz", { origin: "https://evil.example" }))).toBe(true);
  });

  it("no Origin but Sec-Fetch-Site cross-site is cross-site", () => {
    expect(isCrossSiteRequest(post("http://localhost:3000/api/ai/quiz", { "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  it("no browser headers at all (server-to-server, tests) is allowed", () => {
    expect(isCrossSiteRequest(post("http://localhost:3000/api/ai/quiz", {}))).toBe(false);
  });
});

describe("POST /api/ai/quiz (DBT-29)", () => {
  it("rejects a cross-site request with 403 forbidden before any session or AI work", async () => {
    const res = await quizPost(post("http://localhost:3000/api/ai/quiz", { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
});
