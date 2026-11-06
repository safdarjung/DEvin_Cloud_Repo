// UI-side mapping of an ActionResult error to one user-facing line. Every
// ErrorCode is covered; the server message is kept where it is already safe
// and specific (validation, state, scope), generic copy elsewhere.
import type { ErrorCode } from "@/lib/actions/result";

const FALLBACK: Record<ErrorCode, string> = {
  unauthenticated: "Your session expired. Sign in again.",
  forbidden: "You don't have access to do this.",
  not_found: "This item no longer exists. Refresh and try again.",
  validation_failed: "Check the fields and try again.",
  conflict: "Someone changed this already. Refresh and try again.",
  invalid_state: "This can't be done in its current state.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  quota_exceeded: "Usage limit reached.",
  ai_unavailable: "The assistant is unavailable right now.",
  ai_policy_blocked: "This request is blocked by school policy.",
  ai_invalid_output: "The assistant returned an unusable answer. Try again.",
  dependency_failed: "A connected service failed. Try again shortly.",
  internal: "Something went wrong. Try again.",
};

const KEEP_SERVER_MESSAGE: ReadonlySet<ErrorCode> = new Set(["forbidden", "not_found", "validation_failed", "conflict", "invalid_state"]);

export function actionErrorMessage(error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> }): string {
  const field = error.fieldErrors ? Object.values(error.fieldErrors).flat()[0] : undefined;
  if (KEEP_SERVER_MESSAGE.has(error.code) && error.message) {
    return field && !error.message.includes(field) ? `${error.message} ${field}` : error.message;
  }
  return FALLBACK[error.code] ?? FALLBACK.internal;
}
