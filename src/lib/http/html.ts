// M11-T10 — HTML export for GET /api/v1/query/<name>?format=html. Mirrors
// toCsvResponse (csv.ts): wraps an already-computed ActionResult. Errors
// keep the JSON envelope, `null` data is a 404, an ok `{ html }` result
// renders as the document itself, anything else is 422 (not this shape).
import type { ActionResult } from "@/lib/actions/result";
import { fail } from "@/lib/actions/result";
import { apiResponse } from "@/lib/http/api-envelope";

export function toHtmlResponse(result: ActionResult<unknown>): Response {
  if (!result.ok) return apiResponse(result);
  if (result.data === null) return apiResponse(fail("not_found", "Not found."), 404);

  const data = result.data;
  if (!data || typeof data !== "object" || typeof (data as { html?: unknown }).html !== "string") {
    return apiResponse(fail("validation_failed", "Query result is not an HTML document."), 422);
  }

  return new Response((data as { html: string }).html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
    },
  });
}
