"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { exportQuestions, importQuestions } from "@/modules/question-bank/csv.actions";
import { csvRowToQuestionInput, QuestionCreateSchema, QuestionStatusSchema, type QuestionStatus } from "@/modules/question-bank/schemas";
import { pairKey, STATUS_LABEL, type PairMeta } from "./question-meta";

const TEMPLATE = "type,difficulty,body,answer,marks,options,explanation,marking_scheme,learning_outcome,unit_sequence,tolerance\nmcq,easy,What is 2 + 2?,4,1,3|4|5|6,,,,,\n";
const MAX_BYTES = 1_048_576;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

interface Preview { rows: number; errors: Record<string, string[]> }

/** Same row-to-question rules the server runs; the unit_sequence check stays server-side. */
function previewCsv(text: string, gradeId: string, subjectId: string): Preview {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(), transform: (v) => v.trim() });
  const errors: Record<string, string[]> = {};
  if (parsed.errors.length) errors["file"] = [parsed.errors[0].message];
  parsed.data.forEach((row, i) => {
    const r = QuestionCreateSchema.safeParse(csvRowToQuestionInput(row, gradeId, subjectId, undefined));
    if (!r.success) errors[`row ${i + 2}`] = r.error.issues.map((x) => `${x.path.join(".") || "row"}: ${x.message}`);
  });
  return { rows: parsed.data.length, errors };
}

export function ImportDialog({ institutionSlug, pairs, open, onClose, onDone }: { institutionSlug: string; pairs: PairMeta[]; open: boolean; onClose: () => void; onDone: (n: number) => void }) {
  const [pair, setPair] = useState(pairKey(pairs[0].gradeId, pairs[0].subjectId));
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [gradeId, subjectId] = pair.split(":");
  const preview = csv ? previewCsv(csv, gradeId, subjectId) : null;
  const errors = { ...preview?.errors, ...serverErrors };
  const errorRows = Object.entries(errors);

  async function pick(file: File | undefined) {
    setServerErrors({});
    setMessage(null);
    if (!file) return setCsv(null);
    if (file.size > MAX_BYTES) {
      setCsv(null);
      return setMessage("That file is over 1 MB. Split it and import in parts.");
    }
    setFileName(file.name);
    setCsv(await file.text());
  }

  function run() {
    if (!csv) return;
    start(async () => {
      const result = await importQuestions(institutionSlug, { gradeId, subjectId, csv });
      if (!result.ok) {
        setServerErrors(result.error.fieldErrors ?? {});
        setMessage(actionErrorMessage(result.error));
        return;
      }
      toast.success(`${result.data.inserted} questions imported as drafts`);
      if (result.data.warnings.length) toast.warning(`${result.data.warnings.length} look like questions already in the bank`);
      setCsv(null);
      onDone(result.data.inserted);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import questions from CSV</DialogTitle>
          <DialogDescription>Imported questions are saved as drafts and need review. Separate options and multiple answers with |.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">
            Class and subject
            <Select value={pair} onValueChange={(v) => { setPair(v); setServerErrors({}); }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{pairs.map((p) => <SelectItem key={pairKey(p.gradeId, p.subjectId)} value={pairKey(p.gradeId, p.subjectId)}>{p.gradeCode} · {p.subjectName}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="file" accept=".csv,text/csv" aria-label="CSV file" className="max-w-xs" onChange={(e) => pick(e.target.files?.[0])} />
            <Button type="button" variant="ghost" size="sm" onClick={() => download("question-template.csv", TEMPLATE)}>Download template</Button>
          </div>
          {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
          {preview && (
            <div data-testid="import-preview" className="rounded-md border p-3 text-sm">
              <p className="font-medium">{fileName}: {preview.rows} rows, {errorRows.length === 0 ? "all valid" : `${errorRows.length} with problems`}</p>
              {errorRows.length > 0 && (
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-destructive">
                  {errorRows.map(([row, list]) => <li key={row}><span className="font-medium">{row}</span>: {list.join("; ")}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          <Button type="button" disabled={!csv || pending || (preview?.rows ?? 0) === 0 || errorRows.length > 0} onClick={run}>{pending ? "Importing…" : "Import"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExportDialog({ institutionSlug, pairs, open, onClose }: { institutionSlug: string; pairs: PairMeta[]; open: boolean; onClose: () => void }) {
  const [pair, setPair] = useState("all");
  const [status, setStatus] = useState<QuestionStatus>("approved");
  const [pending, start] = useTransition();

  function run() {
    const [gradeId, subjectId] = pair === "all" ? [undefined, undefined] : pair.split(":");
    start(async () => {
      const result = await exportQuestions(institutionSlug, { gradeId, subjectId, status });
      if (!result.ok) return void toast.error(actionErrorMessage(result.error));
      if (result.data.count === 0) return void toast.info("No questions match, so nothing was exported.");
      download(`questions-${status}.csv`, result.data.csv);
      toast.success(`${result.data.count} questions exported${result.data.truncated ? " (limit reached, narrow the filter for the rest)" : ""}`);
      onClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export questions to CSV</DialogTitle>
          <DialogDescription>Downloads the questions you can see, in the same format the import reads.</DialogDescription>
        </DialogHeader>
        <label className="block space-y-1 text-sm">
          Class and subject
          <Select value={pair} onValueChange={setPair}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All I can see</SelectItem>
              {pairs.map((p) => <SelectItem key={pairKey(p.gradeId, p.subjectId)} value={pairKey(p.gradeId, p.subjectId)}>{p.gradeCode} · {p.subjectName}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="block space-y-1 text-sm">
          Status
          <Select value={status} onValueChange={(v) => setStatus(v as QuestionStatus)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{QuestionStatusSchema.options.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={pending} onClick={run}>{pending ? "Exporting…" : "Download CSV"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
