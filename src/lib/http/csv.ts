// M04-T7 — CSV export for GET /api/v1/query/<name>?format=csv. Wraps an
// already-computed ActionResult: errors keep the JSON envelope, an ok
// result exports if its data is a flat-object array (or { rows: [...] }),
// else 422. CSV-injection guard: cells starting with = + - @ are
// apostrophe-prefixed (OWASP CSV injection).
import Papa from "papaparse";
import type { ActionResult } from "@/lib/actions/result";
import { fail } from "@/lib/actions/result";
import { apiResponse } from "@/lib/http/api-envelope";

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function sanitizeCell(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "object") return escapeFormula(JSON.stringify(value));
  if (typeof value === "string") return escapeFormula(value);
  return value;
}

function escapeFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

// A bare array exports directly; an object (e.g. { rows: [...] }, or a
// paginated page object like { students, total, page, pageSize }) exports
// when exactly one of its own values is an array — the unambiguous "the
// list" case. More than one array value, or none, isn't exportable.
function extractRows(data: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const arrayValues = Object.values(data as Record<string, unknown>).filter((value) => Array.isArray(value));
    if (arrayValues.length === 1) return arrayValues[0] as Record<string, unknown>[];
  }
  return null;
}

export function toCsvResponse(result: ActionResult<unknown>, name: string): Response {
  if (!result.ok) return apiResponse(result);

  const rows = extractRows(result.data);
  if (!rows) {
    return apiResponse(fail("validation_failed", "Query result is not exportable as CSV."), 422);
  }

  const sanitized = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) out[key] = sanitizeCell(value);
    return out;
  });

  return new Response(Papa.unparse(sanitized), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.csv"`,
      "cache-control": "no-store",
    },
  });
}
