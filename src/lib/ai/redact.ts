// 07 §5 — redaction before any cloud call (06 §W10). Regex pass for Indian
// phone numbers, emails, 12-digit numbers (Aadhaar-like), and a per-request
// name deny list. Returns the redacted text and a count; the count is
// logged to `ai_usage_events.redactions`, the text itself never is.

export interface RedactResult {
  text: string;
  count: number;
}

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
// Aadhaar is written 4-4-4, contiguous or with space/dash separators.
const TWELVE_DIGIT = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
// Mirrors schemas/common.ts `phoneIN` inside free text: optional +91 or 0
// prefix, and any single space/dash between digits (98765 43210, 9876-543-210).
const PHONE_IN = /(?:\+91[\s-]?|\b0[\s-]?|\b)[6-9](?:[\s-]?\d){9}\b/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redact(text: string, denyNames: readonly string[] = []): RedactResult {
  let count = 0;

  let result = text
    .replace(EMAIL, () => {
      count += 1;
      return "[REDACTED_EMAIL]";
    })
    .replace(TWELVE_DIGIT, () => {
      count += 1;
      return "[REDACTED_ID]";
    })
    .replace(PHONE_IN, () => {
      count += 1;
      return "[REDACTED_PHONE]";
    });

  for (const name of denyNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "gi");
    result = result.replace(pattern, () => {
      count += 1;
      return "[REDACTED_NAME]";
    });
  }

  return { text: result, count };
}
