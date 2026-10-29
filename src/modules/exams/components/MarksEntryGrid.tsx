"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions/result";
import { enterMarks } from "@/modules/exams/actions";
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
    return <p className="text-muted-foreground text-sm">Marks entry is closed for this exam (status: {paper.examStatus}).</p>;
  }

  return (
    <form action={formAction} className="space-y-4">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="p-2 text-left">Roll</th>
            <th className="p-2 text-left">Student</th>
            <th className="p-2 text-left">Marks (/{paper.maxMarks})</th>
            <th className="p-2 text-left">Absent</th>
          </tr>
        </thead>
        <tbody>
          {paper.students.map((student) => {
            const row = rows[student.studentId];
            return (
              <tr key={student.studentId} className="border-t border-border">
                <td className="p-2">{student.rollNo ?? "—"}</td>
                <td className="p-2">{student.name}</td>
                <td className="p-2">
                  <Input
                    type="number"
                    min={0}
                    max={paper.maxMarks}
                    step="0.01"
                    value={row.marksObtained}
                    disabled={row.isAbsent}
                    onChange={(e) => updateRow(student.studentId, { marksObtained: e.target.value })}
                    className="w-24"
                  />
                </td>
                <td className="p-2">
                  <input
                    type="checkbox"
                    aria-label={`${student.name} absent`}
                    checked={row.isAbsent}
                    onChange={(e) => updateRow(student.studentId, { isAbsent: e.target.checked, marksObtained: "" })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {state && !state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {state.error.message}
        </p>
      )}
      {state?.ok && dirtyIds.length === 0 && (
        <p className="text-sm text-muted-foreground">Saved — {state.data.entered} entered, {state.data.unchanged} unchanged.</p>
      )}

      <Button type="submit" disabled={pending || dirtyIds.length === 0}>
        {pending ? "Saving…" : `Save ${dirtyIds.length || ""} change${dirtyIds.length === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}
