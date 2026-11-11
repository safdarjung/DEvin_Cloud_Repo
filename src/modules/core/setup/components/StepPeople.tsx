"use client";

// F18 §H step 3: CSV → header mapping (deterministic matcher; AI slot for the
// leftovers is filled by another packet) → data.import.stage → row errors → data.import.commit.
// File name, headers and cell values are user content: rendered as text only.
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { commitImport, stageImport } from "@/modules/imports/actions";
import { parseCsv, STAFF_COLUMNS, STUDENT_COLUMNS } from "@/modules/imports/schemas";
import { setProgress } from "@/modules/core/setup/actions";
import { suggestColumnMapping, unmappedColumns } from "@/modules/core/setup/column-mapping";
import type { SetupStepState } from "@/modules/core/setup/queries";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const MAX_CSV_BYTES = 1_048_576;
const ENTITIES = { students: STUDENT_COLUMNS, staff: STAFF_COLUMNS } as const;
type Entity = keyof typeof ENTITIES;
// Blank in the file is valid for these (StudentImportRowSchema / StaffImportRowSchema), so they are padded, not demanded.
const OPTIONAL_COLUMNS: Record<Entity, readonly string[]> = {
  students: ["last_name", "roll_no", "guardian_email"],
  staff: ["department", "phone", "email"],
};

interface Parsed {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
}
interface Staged {
  batchId: string;
  rowCount: number;
  validCount: number;
  errorCount: number;
  errors: { rowNo: number; errors: Record<string, string[]> }[];
}

/** What the AI-mapping slot sees: the entity, headers still unmatched, and a confirmed-apply callback. */
export interface AiMappingSlotState {
  entity: Entity;
  unmatchedHeaders: string[];
  /** Applies header -> column picks the owner confirmed; a column already in use, or a header already set, is left alone. */
  apply: (picks: Record<string, string>) => void;
}
const AiMappingContext = createContext<AiMappingSlotState | null>(null);
export const useAiMappingSlot = (): AiMappingSlotState | null => useContext(AiMappingContext);

interface StepPeopleProps {
  institutionSlug: string;
  state: SetupStepState;
  studentCount: number;
  /** Filled by the AI-mapping packet; rendered above the unmapped list and nothing else. Reads its state via useAiMappingSlot(). */
  aiMappingSlot?: ReactNode;
}

export function StepPeople({ institutionSlug, state, studentCount, aiMappingSlot }: StepPeopleProps) {
  const router = useRouter();
  const [entity, setEntity] = useState<Entity>("students");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [staged, setStaged] = useState<Staged | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const columns = ENTITIES[entity];
  const optional = OPTIONAL_COLUMNS[entity];
  const unmapped = parsed ? unmappedColumns(mapping, columns) : [];
  const missing = unmapped.filter((c) => !optional.includes(c));
  const unmappedHeaders = parsed ? parsed.headers.filter((h) => mapping[h] === null) : [];

  function applyAiPicks(picks: Record<string, string>) {
    setMapping((prev) => {
      const used = new Set(Object.values(prev));
      const next = { ...prev };
      for (const [header, column] of Object.entries(picks)) {
        if (next[header] !== null || used.has(column) || !(columns as readonly string[]).includes(column)) continue;
        next[header] = column;
        used.add(column);
      }
      return next;
    });
  }

  function reset(nextEntity: Entity = entity) {
    setEntity(nextEntity);
    setParsed(null);
    setMapping({});
    setStaged(null);
    setResult(null);
    setError(null);
  }

  async function onFile(file: File | null) {
    reset();
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) return setError("Upload a .csv file. Export your spreadsheet as CSV first.");
    if (file.size > MAX_CSV_BYTES) return setError("The file is larger than 1 MB.");
    try {
      const { headers, rows } = parseCsv(await file.text());
      setParsed({ fileName: file.name, headers, rows });
      setMapping(suggestColumnMapping(headers, columns));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The file could not be read.");
    }
  }

  function changeEntity(next: Entity) {
    if (parsed) {
      setMapping(suggestColumnMapping(parsed.headers, ENTITIES[next]));
      setStaged(null);
    }
    setEntity(next);
  }

  /** The stage action wants the import columns as header names, so rewrite the CSV with the mapping applied. */
  function mappedCsv(p: Parsed): string {
    const used = p.headers.filter((h) => mapping[h]);
    const blanks = unmapped.filter((c) => optional.includes(c));
    return Papa.unparse({
      fields: [...used.map((h) => mapping[h] as string), ...blanks],
      data: p.rows.map((r) => [...used.map((h) => r[h] ?? ""), ...blanks.map(() => "")]),
    });
  }

  async function stage() {
    if (!parsed) return;
    setPending(true);
    setError(null);
    const res = await stageImport(institutionSlug, { entityType: entity, fileName: parsed.fileName, csv: mappedCsv(parsed) });
    setPending(false);
    if (!res.ok) return setError(describeActionError(res.error));
    setStaged(res.data);
  }

  async function commit() {
    if (!staged) return;
    setPending(true);
    setError(null);
    const res = await commitImport(institutionSlug, { batchId: staged.batchId });
    if (!res.ok) {
      setPending(false);
      return setError(describeActionError(res.error));
    }
    await setProgress(institutionSlug, { step: "people", state: "done" });
    setPending(false);
    setResult(`Imported ${res.data.committed} rows. ${res.data.skipped} skipped, ${res.data.invalid} invalid.`);
    setParsed(null);
    setStaged(null);
    router.refresh();
  }

  async function skip() {
    setPending(true);
    const res = await setProgress(institutionSlug, { step: "people", state: state === "dismissed" ? "todo" : "dismissed" });
    setPending(false);
    if (!res.ok) return setError(describeActionError(res.error));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {studentCount > 0 && <p className="text-sm text-muted-foreground">{studentCount} students are already in the system. You can import more.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="people-entity">What are you importing?</Label>
          <select id="people-entity" className={SELECT_CLASS} value={entity} disabled={pending} onChange={(e) => changeEntity(e.target.value as Entity)}>
            <option value="students">Students and guardians</option>
            <option value="staff">Staff</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="people-file">CSV file (up to 1 MB)</Label>
          <Input id="people-file" type="file" accept=".csv,text/csv" disabled={pending} onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
          <p className="text-xs text-muted-foreground">Excel files are not read here. Save the sheet as CSV first.</p>
        </div>
      </div>

      {parsed && !staged && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">
            Match the columns in {parsed.fileName} ({parsed.rows.length} rows)
          </p>
          {aiMappingSlot && (
            <AiMappingContext value={{ entity, unmatchedHeaders: unmappedHeaders, apply: applyAiPicks }}>{aiMappingSlot}</AiMappingContext>
          )}
          {missing.length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              Not matched yet: {missing.join(", ")}. These are needed before you can continue.
            </p>
          )}
          {unmappedHeaders.length > 0 && <p className="text-xs text-muted-foreground">Unmatched headers: {unmappedHeaders.join(", ")}</p>}
          <ul className="grid gap-2 sm:grid-cols-2">
            {parsed.headers.map((header, i) => (
              <li key={`${i}-${header}`} className="flex flex-col gap-1">
                <Label htmlFor={`map-${i}`}>
                  <span className="truncate">{header || "(blank header)"}</span>
                </Label>
                <select
                  id={`map-${i}`}
                  className={SELECT_CLASS}
                  value={mapping[header] ?? ""}
                  disabled={pending}
                  onChange={(e) => {
                    const column = e.target.value || null;
                    // A column belongs to one header: release it from any other.
                    setMapping((prev) => Object.fromEntries(Object.entries({ ...prev, [header]: column }).map(([h, c]) => [h, h !== header && c === column && column ? null : c])));
                  }}
                >
                  <option value="">Do not import</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <Button onClick={stage} disabled={pending || missing.length > 0}>
            {pending ? "Checking…" : "Check the file"}
          </Button>
        </div>
      )}

      {staged && (
        <div className="space-y-3 rounded-lg border border-border p-4 text-sm">
          <p>
            {staged.rowCount} rows checked: {staged.validCount} ready, {staged.errorCount} with errors.
            {staged.errorCount > 0 && " Rows with errors are skipped. Fix them in the file and import again."}
          </p>
          {staged.errors.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-auto text-xs text-destructive">
              {staged.errors.map((r) => (
                <li key={r.rowNo}>
                  Row {r.rowNo}: {Object.entries(r.errors).map(([field, msgs]) => `${field} ${msgs.join(", ")}`).join("; ")}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button onClick={commit} disabled={pending || staged.validCount === 0}>
              {pending ? "Importing…" : `Import ${staged.validCount} rows`}
            </Button>
            <Button variant="outline" onClick={() => reset()} disabled={pending}>
              Start over
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <p role="status" className="text-sm text-muted-foreground">
          {result}
        </p>
      )}
      <Button variant="ghost" onClick={skip} disabled={pending}>
        {state === "dismissed" ? "Resume this step" : "Skip for now"}
      </Button>
    </div>
  );
}
