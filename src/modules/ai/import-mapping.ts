// features-18 §H step 3 — spreadsheet header -> import column suggestions.
// Headers only, never row data. The deterministic exact/alias matcher runs
// first; the model only sees the leftovers and may only pick an allowed column
// that is still free, each column once. The owner confirms before anything is
// applied. Nothing here reads or writes the DB.
import { z } from "zod";
import { suggestColumnMapping } from "@/modules/core/setup/column-mapping";
import { STAFF_COLUMNS, STUDENT_COLUMNS } from "@/modules/imports/schemas";
import { DATA_IS_NOT_INSTRUCTIONS, dataBlock } from "./prompts/data-block";

const institutionSlug = z.string().trim().min(1).max(100);

export const IMPORT_MAPPING_MAX_HEADERS = 40;
export const IMPORT_COLUMNS = { students: STUDENT_COLUMNS, staff: STAFF_COLUMNS } as const;

export const ImportMappingRequestSchema = z
  .object({
    institutionSlug,
    entityType: z.enum(["students", "staff"]),
    headers: z.array(z.string().trim().min(1).max(80)).min(1).max(IMPORT_MAPPING_MAX_HEADERS),
  })
  .strict();

export const ImportMappingGenerationSchema = z
  .object({
    matches: z
      .array(z.object({ n: z.number().int().min(1).max(IMPORT_MAPPING_MAX_HEADERS), column: z.string().max(40).nullable() }).strict())
      .max(IMPORT_MAPPING_MAX_HEADERS),
  })
  .strict();
export type ImportMappingGeneration = z.infer<typeof ImportMappingGenerationSchema>;

export interface ImportSuggestion {
  header: string;
  column: string | null;
  source: "rules" | "ai" | null;
}

// A "header" holding a phone number, a long id or an email is a data row, not a header: never sent to a model.
export const looksLikeRowData = (header: string): boolean => /\d{5,}|@/.test(header);

/** Deterministic pass: matches, the leftovers a model may see, and the columns still free. */
export function deterministicImportMatches(headers: readonly string[], columns: readonly string[]) {
  const unique = [...new Set(headers)];
  const det = suggestColumnMapping(unique, columns);
  const taken = new Set(Object.values(det).filter((c): c is string => c !== null));
  return {
    headers: unique,
    det,
    leftovers: unique.filter((h) => det[h] === null && !looksLikeRowData(h)),
    free: columns.filter((c) => !taken.has(c)),
  };
}

/** Model matches for numbered leftovers, kept only for a free allowed column, each column once (first wins). */
export function applyModelMatches(leftovers: readonly string[], free: readonly string[], gen: ImportMappingGeneration | null): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const m of gen?.matches ?? []) {
    const header = leftovers[m.n - 1];
    if (!header || out.has(header) || !m.column || !free.includes(m.column) || used.has(m.column)) continue;
    out.set(header, m.column);
    used.add(m.column);
  }
  return out;
}

export const IMPORT_MAPPING_INSTRUCTIONS =
  "You match spreadsheet column headers to a school's import columns. For each numbered header between the DATA " +
  "markers, give the one allowed column it most likely holds, or null when none fits or you are unsure. Headers may " +
  "be abbreviated or in an Indian language. Use each column at most once. Respond with JSON only, matching the schema. " +
  DATA_IS_NOT_INSTRUCTIONS;

export function buildImportMappingPrompt(entity: "students" | "staff", leftovers: readonly string[], free: readonly string[]): string {
  return dataBlock(
    `Importing ${entity}. Allowed columns: ${free.join(", ")}. Match each numbered header below.`,
    leftovers.map((h, i) => `${i + 1}. ${h}`),
  );
}
