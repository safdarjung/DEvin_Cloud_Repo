"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/actions/result";
import { enterMarks } from "@/modules/exams/actions";
import { humanize } from "@/lib/format";
import { marksSheetCsv, readMarksSheet } from "@/modules/exams/marks-sheet";
import type { PaperMarks } from "@/modules/exams/queries";
import { ProgressBar } from "@/components/widgets/viz";

interface RowState {
  marksObtained: string;
  isAbsent: boolean;
}

function initialRows(paper: PaperMarks): Record<string, RowState> {
  const rows: Record<string, RowState> = {};
  for (const student of paper.students) {
    rows[student.studentId] = {
      marksObtained: student.marksObtained == null ? "" : String(student.marksObtained),
      isAbsent: student.isAbsent,
    };
  }
  return rows;
}

interface MarksEntryGridProps {
  institutionSlug: string;
  paper: PaperMarks;
}

/** 06 §W7's marks-entry grid: absent checkbox, dirty tracking (only changed rows are sent to `enterMarks` — the RPC itself also no-ops unchanged rows, but sending fewer avoids per-row server work). */
export function MarksEntryGrid({ institutionSlug, paper }: MarksEntryGridProps) {
  const baseline = useMemo(() => initialRows(paper), [paper]);
  const [rows, setRows] = useState<Record<string, RowState>>(baseline);
  const [saved, setSaved] = useState(baseline);
  const [sheet, setSheet] = useState<{ filled: number; problems: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canEdit = paper.examStatus === "marks_entry" || paper.examStatus === "verification";

  const dirtyIds = Object.keys(rows).filter((id) => {
    const row = rows[id];
    const base = saved[id];
    return row.isAbsent !== base.isAbsent || row.marksObtained !== base.marksObtained;
  });

  const enteredCount = Object.values(rows).filter((r) => r.isAbsent || r.marksObtained !== "").length;

  function updateRow(studentId: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId], ...patch } }));
  }

  // Marks from a spreadsheet: download the class list, fill it in Excel or Google Sheets, upload it back.
  // The upload only fills the grid; the teacher checks it and presses Save.
  function downloadSheet() {
    const csv = marksSheetCsv(paper.students, rows, paper.maxMarks);
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${paper.sectionLabel} ${paper.subjectName} marks.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function uploadSheet(file: File) {
    const { rows: filled, problems } = readMarksSheet(await file.text(), paper.students, paper.maxMarks);
    setRows((prev) => ({ ...prev, ...filled }));
    setSheet({ filled: Object.keys(filled).length, problems });
  }

  const [state, formAction, pending] = useActionState<ActionResult<{ entered: number; unchanged: number }> | null, FormData>(
    async () => {
      const marks = dirtyIds.map((studentId) => {
        const row = rows[studentId];
        return {
          studentId,
          isAbsent: row.isAbsent,
          marksObtained: row.isAbsent ? undefined : row.marksObtained === "" ? undefined : Number(row.marksObtained),
        };
      });
      const result = await enterMarks(institutionSlug, { examPaperId: paper.paperId, marks });
      if (result.ok) setSaved(rows);
      return result;
    },
    null,
  );

  if (!canEdit) {
    return (
      <EmptyState
        title="Marks entry is closed"
        description={`This exam is ${humanize(paper.examStatus).toLowerCase()}, so marks can no longer be edited here.`}
      />
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={downloadSheet}>
          <Download className="size-4" aria-hidden />
          Download sheet
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" aria-hidden />
          Upload filled sheet
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void uploadSheet(file);
          }}
        />
        <p className="text-xs text-muted-foreground">Fill it in Excel or Google Sheets, save or download it as CSV, and upload it. Nothing is saved until you press Save.</p>
      </div>
      {sheet && (
        <div role="status" className="space-y-1 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p>
            The sheet filled {sheet.filled} student{sheet.filled === 1 ? "" : "s"}. Check the marks below, then press Save.
          </p>
          {sheet.problems.length > 0 && (
            <ul className="list-disc pl-5 text-destructive">
              {sheet.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ProgressBar
        label="Entered (marks or absent)"
        value={enteredCount}
        max={paper.students.length}
        valueLabel={`${enteredCount} / ${paper.students.length}`}
        tone={enteredCount === paper.students.length ? "success" : "default"}
      />
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-card">Student</TableHead>
                <TableHead className="hidden sm:table-cell">Roll</TableHead>
                <TableHead>Marks (/{paper.maxMarks})</TableHead>
                <TableHead>Absent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paper.students.map((student) => {
                const row = rows[student.studentId];
                return (
                  <TableRow key={student.studentId}>
                    <TableCell className="sticky left-0 z-10 bg-card font-medium">
                      {student.name}
                      <span className="block text-xs font-normal text-muted-foreground sm:hidden">Roll {student.rollNo ?? "—"}</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{student.rollNo ?? "—"}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={paper.maxMarks}
                        step="0.01"
                        value={row.marksObtained}
                        disabled={row.isAbsent}
                        aria-label={`${student.name} marks`}
                        onChange={(e) => updateRow(student.studentId, { marksObtained: e.target.value })}
                        className="w-24"
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`${student.name} absent`}
                        checked={row.isAbsent}
                        onChange={(e) => updateRow(student.studentId, { isAbsent: e.target.checked, marksObtained: "" })}
                        className="size-5 accent-primary"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {state && !state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {state.error.message}
        </p>
      )}
      {state?.ok && dirtyIds.length === 0 && (
        <p role="status" className="text-sm text-success">Saved — {state.data.entered} entered, {state.data.unchanged} unchanged.</p>
      )}

      <Button type="submit" disabled={pending || dirtyIds.length === 0}>
        {pending ? "Saving…" : `Save ${dirtyIds.length || ""} change${dirtyIds.length === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}
