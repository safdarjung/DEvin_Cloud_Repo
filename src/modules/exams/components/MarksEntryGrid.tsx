"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionResult } from "@/lib/actions/result";
import { enterMarks } from "@/modules/exams/actions";
import { examStatusLabel } from "@/modules/exams/components/ResultsTable";
import type { PaperMarks } from "@/modules/exams/queries";

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

  const canEdit = paper.examStatus === "marks_entry" || paper.examStatus === "verification";

  const dirtyIds = Object.keys(rows).filter((id) => {
    const row = rows[id];
    const base = saved[id];
    return row.isAbsent !== base.isAbsent || row.marksObtained !== base.marksObtained;
  });

  function updateRow(studentId: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId], ...patch } }));
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
        description={`This exam is ${examStatusLabel(paper.examStatus).toLowerCase()}, so marks can no longer be edited here.`}
      />
    );
  }

  return (
    <form action={formAction} className="space-y-4">
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
                        className="h-10 w-24 sm:h-8"
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

      <Button type="submit" className="h-10 sm:h-8" disabled={pending || dirtyIds.length === 0}>
        {pending ? "Saving…" : `Save ${dirtyIds.length || ""} change${dirtyIds.length === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}
