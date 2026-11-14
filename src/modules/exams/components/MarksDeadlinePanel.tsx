"use client";

// 0154: the exam office sets when marks are due and sees, by teacher, which papers are still
// missing marks. Teachers with missing papers and the exam office get an in-app reminder each day
// from 2 days before the date (notify.marks_reminders).
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setMarksDue } from "@/modules/exams/actions";
import { daysLeft, REMIND_DAYS_BEFORE, type PaperProgress } from "@/modules/exams/marks-progress";

interface Props {
  institutionSlug: string;
  examId: string;
  examStatus: string;
  marksDueOn: string | null;
  progress: PaperProgress[];
  /** Today in the school's time zone (YYYY-MM-DD). */
  today: string;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const show = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

function dueLine(dueOn: string, today: string): string {
  const left = daysLeft(dueOn, today);
  if (left > 0) return `Due ${show(dueOn)} · ${left} day${left === 1 ? "" : "s"} left`;
  if (left === 0) return `Due today (${show(dueOn)})`;
  return `Due ${show(dueOn)} · ${-left} day${left === -1 ? "" : "s"} late`;
}

export function MarksDeadlinePanel({ institutionSlug, examId, examStatus, marksDueOn, progress, today }: Props) {
  const [date, setDate] = useState(marksDueOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const late = marksDueOn !== null && daysLeft(marksDueOn, today) < 0;
  const done = progress.filter((p) => p.done).length;
  // Missing papers first, grouped by teacher; finished papers last.
  const rows = [...progress].sort((a, b) => Number(a.done) - Number(b.done) || (a.teacher?.name ?? "~").localeCompare(b.teacher?.name ?? "~") || a.label.localeCompare(b.label));

  function save(value: string | null) {
    setError(null);
    start(async () => {
      const result = await setMarksDue(institutionSlug, { examId, marksDueOn: value });
      if (!result.ok) setError(result.error.message);
      else if (value === null) setDate("");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Marks deadline</CardTitle>
        <p className="text-sm text-muted-foreground">
          {marksDueOn ? `${dueLine(marksDueOn, today)}.` : "No date set."} {progress.length > 0 && `${done} of ${progress.length} papers have every mark in.`}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (date) save(date);
          }}
        >
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Marks due by</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" required />
          </label>
          <Button type="submit" disabled={pending || !date || date === marksDueOn}>
            {pending ? "Saving…" : "Save date"}
          </Button>
          {marksDueOn && (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => save(null)}>
              Clear
            </Button>
          )}
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {examStatus === "marks_entry"
            ? `From ${REMIND_DAYS_BEFORE} days before the date, each teacher with missing marks and the exam office get an in-app reminder every morning until the marks are in.`
            : "Reminders go out only while marks entry is open."}
        </p>

        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Teacher</TableHead>
                <TableHead>Paper</TableHead>
                <TableHead className="text-right">Marks in</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.paperId}>
                  <TableCell>{p.teacher?.name ?? <span className="text-muted-foreground">No teacher assigned</span>}</TableCell>
                  <TableCell>{p.label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.entered}/{p.total}
                  </TableCell>
                  <TableCell>
                    {p.done ? (
                      <Badge variant="success">Done</Badge>
                    ) : late ? (
                      <Badge variant="destructive">Late</Badge>
                    ) : (
                      <Badge variant="warning">Not submitted</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
