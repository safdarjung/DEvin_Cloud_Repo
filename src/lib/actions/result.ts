// 06 §1.1 — the result envelope every action returns. SQL functions raise
// `code:<ErrorCode>`; the action layer maps that prefix to this union and
// everything else to `internal` (logged, never shown raw).
export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "invalid_state"
  | "rate_limited"
  | "quota_exceeded"
  | "ai_unavailable"
  | "ai_policy_blocked"
  | "ai_invalid_output"
  | "dependency_failed"
  | "internal";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> } };

// Thrown by requirePermission and action handlers to signal a known error;
// defineAction catches it and maps it straight to the envelope below.
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(code: ErrorCode, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(
  code: ErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<never> {
  return fieldErrors ? { ok: false, error: { code, message, fieldErrors } } : { ok: false, error: { code, message } };
}

const KNOWN_ERROR_CODES = new Set<string>([
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
]);

function isKnownErrorCode(value: string): value is ErrorCode {
  return KNOWN_ERROR_CODES.has(value);
}

/**
 * Maps a Postgres/PostgREST error to the envelope. SQL functions raise
 * `code:<ErrorCode>` as the exception message with the human-readable text
 * in `detail`/`details` (06 §1.1). Anything else is logged server-side with
 * a correlation id and returned as `internal` — never the raw SQL text.
 */
export function mapSqlError(err: unknown): ActionResult<never> {
  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : "";
  const match = /^code:([a-z_]+)$/.exec(message);

  if (match && isKnownErrorCode(match[1])) {
    const rawDetail =
      typeof err === "object" && err !== null
        ? (err as { detail?: unknown; details?: unknown }).detail ??
          (err as { detail?: unknown; details?: unknown }).details
        : undefined;
    const detail = typeof rawDetail === "string" && rawDetail.length > 0 ? rawDetail : message;
    return fail(match[1], detail);
  }

  // Raw SQLSTATEs that must never surface as `internal` (M12 ruling "Error
  // codes"); fixed messages, never the SQL text.
  const sqlState = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  if (sqlState === "42501") return fail("forbidden", "You do not have access to this record.");
  if (sqlState === "23505") return fail("conflict", "This record already exists.");
  if (sqlState === "23503") return fail("not_found", "A related record was not found.");

  const correlationId = crypto.randomUUID();
  console.error(`[${correlationId}] unexpected SQL error`, err);
  return fail("internal", `Something went wrong. Reference: ${correlationId}`);
}
