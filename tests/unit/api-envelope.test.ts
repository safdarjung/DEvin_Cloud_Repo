import { describe, expect, it } from "vitest";
import type { ErrorCode } from "@/lib/actions/result";
import { apiResponse, bearerToken, HTTP_STATUS } from "@/lib/http/api-envelope";

const ALL_CODES: ErrorCode[] = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "validation_failed",
  "conflict",
  "invalid_state",
  "rate_limited",
  "quota_exceeded",
  "ai_unavailable",
  "ai_policy_blocked",
  "ai_invalid_output",
  "dependency_failed",
  "internal",
];

describe("HTTP_STATUS", () => {
  it("maps every ErrorCode to a 4xx/5xx status", () => {
    for (const code of ALL_CODES) {
      const status = HTTP_STATUS[code];
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it("maps specific codes to their documented status", () => {
    expect(HTTP_STATUS.unauthenticated).toBe(401);
    expect(HTTP_STATUS.forbidden).toBe(403);
    expect(HTTP_STATUS.not_found).toBe(404);
    expect(HTTP_STATUS.validation_failed).toBe(422);
    expect(HTTP_STATUS.conflict).toBe(409);
    expect(HTTP_STATUS.invalid_state).toBe(409);
    expect(HTTP_STATUS.rate_limited).toBe(429);
    expect(HTTP_STATUS.quota_exceeded).toBe(429);
    expect(HTTP_STATUS.ai_unavailable).toBe(503);
    expect(HTTP_STATUS.ai_policy_blocked).toBe(403);
    expect(HTTP_STATUS.ai_invalid_output).toBe(502);
    expect(HTTP_STATUS.dependency_failed).toBe(502);
    expect(HTTP_STATUS.internal).toBe(500);
  });
});

describe("apiResponse", () => {
  it("returns 200 with the envelope body for an ok result", async () => {
    const res = apiResponse({ ok: true, data: { foo: "bar" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ ok: true, data: { foo: "bar" } });
  });

  it("maps a fail result's code to its HTTP_STATUS and keeps fieldErrors", async () => {
    const res = apiResponse({
      ok: false,
      error: { code: "validation_failed", message: "bad input", fieldErrors: { email: ["required"] } },
    });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: "validation_failed", message: "bad input", fieldErrors: { email: ["required"] } },
    });
  });

  it("overrides the mapped status when a status argument is given", () => {
    const res = apiResponse({ ok: false, error: { code: "validation_failed", message: "bad" } }, 400);
    expect(res.status).toBe(400);
  });

  it("overrides the 200 default for an ok result when a status argument is given", () => {
    const res = apiResponse({ ok: true, data: null }, 413);
    expect(res.status).toBe(413);
  });
});

describe("bearerToken", () => {
  function reqWithAuth(value: string | null): Request {
    const headers = new Headers();
    if (value !== null) headers.set("authorization", value);
    return new Request("http://localhost/api", { headers });
  }

  it("parses a lowercase bearer scheme", () => {
    expect(bearerToken(reqWithAuth("bearer abc"))).toBe("abc");
  });

  it("parses the standard Bearer scheme and trims the token", () => {
    expect(bearerToken(reqWithAuth("Bearer  abc123  "))).toBe("abc123");
  });

  it("rejects a non-bearer scheme", () => {
    expect(bearerToken(reqWithAuth("Basic x"))).toBeNull();
  });

  it("rejects a bearer scheme with no token", () => {
    expect(bearerToken(reqWithAuth("Bearer "))).toBeNull();
  });

  it("returns null when the header is missing", () => {
    expect(bearerToken(reqWithAuth(null))).toBeNull();
  });
});
