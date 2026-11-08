"use client";

// T-015 — 06 §W5 register. Single client component, local state, one
// `markAttendance` call for all rows on save (packet: "one action call on
// submit" — not one call per student) plus a separate `submitAttendance`
// call to finalize. shortcut: status buttons are click/Tab/Enter only, no
// custom hotkey grid — upgrade if teachers need faster entry for 45-row
// sections.
import { SimulatedBadge } from "@/components/honesty";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarList, ProgressBar, RadialGauge } from "@/components/widgets/viz";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import { markAttendance, submitAttendance } from "@/modules/attendance/actions";
import { CorrectionDialog } from "@/modules/attendance/components/CorrectionDialog";
import type { AttendanceStatusOption, AttendanceStudentRow } from "@/modules/attendance/queries";

interface AttendanceRegisterProps {
  institutionSlug: string;
  sectionId: string;
  sectionLabel: string;
  date: string;
  students: AttendanceStudentRow[];
  statuses: AttendanceStatusOption[];
  initialSessionId: string | null;
  initialSessionStatus: "open" | "submitted" | null;
  /** Whether the signed-in member may offer corrections (attendance.correct) — RLS/the RPC are the real boundary. */
  canCorrect: boolean;
}

type Draft = Record<string, { status: string; note: string }>;

export function AttendanceRegister({
  institutionSlug,
  sectionId,
  sectionLabel,
  date,
  students,
  statuses,
  initialSessionId,
  initialSessionStatus,
  canCorrect,
}: AttendanceRegisterProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(students.map((s) => [s.studentId, { status: s.status ?? "", note: s.note ?? "" }])),
  );
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [sessionStatus, setSessionStatus] = useState(initialSessionStatus);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; simulated?: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const [correctingStudentId, setCorrectingStudentId] = useState<string | null>(null);

  const isSubmitted = sessionStatus === "submitted";
  const defaultStatus = statuses[0]?.code ?? "";

  const allMarked = useMemo(
    () => students.every((s) => Boolean(draft[s.studentId]?.status)),
    [students, draft],
  );

  // Live tally of the draft (no extra query): marked count, per-status
  // counts, and present % over statuses that count toward the denominator.
  const tally = useMemo(() => {
    const counts = new Map<string, number>();
    let presentWeighted = 0;
    let denominator = 0;
    for (const s of students) {
      const code = draft[s.studentId]?.status;
      const option = statuses.find((st) => st.code === code);
      if (!code || !option) continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
      if (option.inDenominator) {
        denominator += 1;
        presentWeighted += option.countsPresent;
      }
    }
    const marked = [...counts.values()].reduce((a, b) => a + b, 0);
    return { counts, marked, presentPct: denominator > 0 ? (presentWeighted / denominator) * 100 : null };
  }, [students, statuses, draft]);

  function setStatus(studentId: string, status: string) {
    setDraft((d) => ({ ...d, [studentId]: { ...(d[studentId] ?? { note: "" }), status } }));
  }

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await markAttendance(institutionSlug, {
        classSectionId: sectionId,
        date,
        records: students.map((s) => ({
          studentId: s.studentId,
          status: draft[s.studentId]?.status || defaultStatus,
          note: draft[s.studentId]?.note || undefined,
        })),
      });
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      setSessionId(result.data.sessionId);
      setMessage({ kind: "ok", text: `Saved attendance for ${result.data.recordCount} students.` });
    });
  }

  function handleSubmit() {
    if (!sessionId) return;
    setMessage(null);
    startTransition(async () => {
      const result = await submitAttendance(institutionSlug, { sessionId });
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error.message });
        return;
      }
      setSessionStatus("submitted");
      const absences = students.filter((s) => {
        const code = draft[s.studentId]?.status;
        return statuses.find((st) => st.code === code)?.notifyGuardian;
      }).length;
      setMessage({
        kind: "ok",
        text: `Attendance submitted — ${absences} absence${absences === 1 ? "" : "s"}, guardians notified`,
        simulated: true,
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={sectionLabel}
        description={isSubmitted ? `${date} · Submitted. Use "Correct" to change a record.` : date}
        back={{ href: `/${institutionSlug}/attendance`, label: "Attendance" }}
        actions={
          !isSubmitted && (
            <>
              <Button variant="outline" onClick={handleSave} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button onClick={handleSubmit} disabled={pending || !sessionId || !allMarked}>
                Submit
              </Button>
            </>
          )
        }
      />

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={cn("text-sm", message.kind === "error" ? "text-destructive" : "text-muted-foreground")}>
          {message.text}
          {message.simulated && (
            <>
              <span className="sr-only"> (SMS simulated).</span> <SimulatedBadge />
            </>
          )}
        </p>
      )}

      {students.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Register summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
            {tally.presentPct !== null ? (
              <RadialGauge value={tally.presentPct} label="Present" sublabel={`${tally.marked} of ${students.length} marked`} />
            ) : (
              <p className="text-sm text-muted-foreground">No students marked yet.</p>
            )}
            <div className="min-w-0 space-y-3">
              <ProgressBar label="Marked" value={tally.marked} max={students.length} valueLabel={`${tally.marked} / ${students.length}`} />
              <BarList
                ariaLabel="Students per status"
                max={students.length}
                items={statuses.map((st) => {
                  const count = tally.counts.get(st.code) ?? 0;
                  return { label: st.label, value: count, tone: st.notifyGuardian ? "warning" : "default" };
                })}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="hidden sm:table-cell">Roll no.</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Status</TableHead>
                {canCorrect && <TableHead>Correct</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((student) => {
                const current = draft[student.studentId]?.status ?? "";
                return (
                  <TableRow key={student.studentId}>
                    <TableCell className="hidden sm:table-cell">{student.rollNo ?? "—"}</TableCell>
                    <TableCell className="min-w-0 break-words whitespace-normal">{student.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-nowrap gap-1" role="radiogroup" aria-label={`Attendance status for ${student.name}`}>
                        {statuses.map((status) => (
                          <Button
                            key={status.code}
                            type="button"
                            size="sm"
                            title={status.label}
                            className="h-10 min-w-9 px-2 sm:h-7 sm:min-w-0 sm:px-2.5"
                            variant={current === status.code ? "default" : "outline"}
                            role="radio"
                            aria-checked={current === status.code}
                            disabled={isSubmitted}
                            onClick={() => setStatus(student.studentId, status.code)}
                          >
                            {status.code}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                    {canCorrect && (
                      <TableCell>
                        {isSubmitted && current && student.recordId && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setCorrectingStudentId(student.studentId)}
                            >
                              Correct
                            </Button>
                            {correctingStudentId === student.studentId && (
                              <CorrectionDialog
                                institutionSlug={institutionSlug}
                                recordId={student.recordId}
                                studentName={student.name}
                                currentStatus={current}
                                statuses={statuses}
                                open={correctingStudentId === student.studentId}
                                onOpenChange={(open) => !open && setCorrectingStudentId(null)}
                                onCorrected={(newStatus) => {
                                  setStatus(student.studentId, newStatus);
                                  router.refresh();
                                }}
                              />
                            )}
                          </>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
