import type { ErrorCode } from "@/lib/actions/result";

/** User-facing text for every ErrorCode a client component can receive from an action. */
export function describeActionError(error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> }): string {
  switch (error.code) {
    case "unauthenticated":
      return "Your session has expired. Sign in again.";
    case "forbidden":
      return "You do not have permission to do this.";
    case "not_found":
      return "This item no longer exists. Refresh the page.";
    case "conflict":
    case "invalid_state":
      return error.message || "Someone else already handled this. Refresh the page.";
    case "validation_failed": {
      const first = error.fieldErrors ? Object.values(error.fieldErrors).flat()[0] : undefined;
      return first ? `${error.message} ${first}`.trim() : error.message || "Check the details and try again.";
    }
    case "rate_limited":
      return "Too many requests. Wait a moment and try again.";
    case "quota_exceeded":
      return "A usage limit was reached. Try again later.";
    case "dependency_failed":
      return "A connected service is unavailable. Try again shortly.";
    case "internal":
      return "Something went wrong. Try again.";
    default:
      return error.message || "Something went wrong. Try again.";
  }
}
