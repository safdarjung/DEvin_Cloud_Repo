// M01 §T1 — maps the action-layer ActionResult envelope onto the HTTP
// dispatcher's Response. One mapping lives here so every route agrees.
import type { ActionResult, ErrorCode } from "@/lib/actions/result";

export const HTTP_STATUS = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  invalid_state: 409,
  rate_limited: 429,
  quota_exceeded: 429,
  ai_unavailable: 503,
  ai_policy_blocked: 403,
  ai_invalid_output: 502,
  dependency_failed: 502,
  internal: 500,
} satisfies Record<ErrorCode, number>;

/**
 * Builds the dispatcher's Response from an ActionResult. `status`, when
 * given, overrides the mapped/200 code (T4 uses this for 400/413 cases the
 * action layer itself never produces). The JSON body is the envelope as-is.
 */
export function apiResponse(result: ActionResult<unknown>, status?: number): Response {
  const resolvedStatus = status ?? (result.ok ? 200 : HTTP_STATUS[result.error.code]);
  return Response.json(result, { status: resolvedStatus, headers: { "cache-control": "no-store" } });
}

/**
 * Extracts the token from an `Authorization: Bearer <token>` header.
 * Case-insensitive scheme match; null on any other scheme, empty token, or
 * missing header.
 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const match = /^Bearer\s+(.*)$/i.exec(header);
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}
