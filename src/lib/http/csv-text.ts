// M15-T6 — shared CSV text helpers, moved out of csv.ts (M04-T7) so plain
// node (the report.generate job handler, M15-T9) can produce CSV text
// without importing the Next-only ActionResult/apiResponse pipeline there.
// Same CSV-injection guard: cells starting with = + - @ are
// apostrophe-prefixed (OWASP CSV injection). No behavior change in csv.ts.
import Papa from "papaparse";

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function sanitizeCell(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "object") return escapeFormula(JSON.stringify(value));
  if (typeof value === "string") return escapeFormula(value);
  return value;
}

export function escapeFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

/** Inverse of escapeFormula for re-importing our own exports. A real cell starting `'=` loses its apostrophe. */
export function unescapeFormula(value: string): string {
  return value.startsWith("'") && FORMULA_PREFIX.test(value.slice(1)) ? value.slice(1) : value;
}

// `columns` fixes the header order (and which keys are emitted) via
// Papa's `columns` option. For 0 rows, Papa.unparse([]) drops the header
// entirely (empty-array branch in papaparse), so a 0-row + columns call is
// special-cased to emit the header line alone.
export function rowsToCsvText(rows: Record<string, unknown>[], columns?: readonly string[]): string {
  if (rows.length === 0) {
    return columns ? Papa.unparse([[...columns]]) : "";
  }

  const sanitized = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) out[key] = sanitizeCell(value);
    return out;
  });

  return Papa.unparse(sanitized, columns ? { columns: [...columns] } : undefined);
}
