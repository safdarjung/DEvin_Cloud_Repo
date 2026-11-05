// M11-T10 — `?format=html` support: toHtmlResponse(result) wraps an
// already-computed ActionResult (exams.reportCardHtml's shape) into an
// HTML Response, or passes the JSON envelope through unchanged for
// errors. No DB: pure function, mocked ActionResult inputs.
import { describe, expect, it } from "vitest";
import { toHtmlResponse } from "@/lib/http/html";

describe("toHtmlResponse (M11-T10)", () => {
  it("{ html } ok result -> 200 text/html with the 5 response headers", async () => {
    const res = toHtmlResponse({ ok: true, data: { html: "<!doctype html><p>hi</p>" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'",
    );
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    await expect(res.text()).resolves.toBe("<!doctype html><p>hi</p>");
  });

  it("null ok result -> 404 not_found JSON envelope", async () => {
    const res = toHtmlResponse({ ok: true, data: null });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: { code: "not_found", message: expect.any(String) } });
  });

  it("other ok result shape (e.g. array) -> 422 validation_failed", async () => {
    const res = toHtmlResponse({ ok: true, data: [] });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("validation_failed");
  });

  it("error result keeps the JSON envelope unchanged", async () => {
    const res = toHtmlResponse({ ok: false, error: { code: "forbidden", message: "nope" } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: { code: "forbidden", message: "nope" } });
  });
});
