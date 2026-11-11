import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule } from "@/lib/auth/require";
import { listExams } from "@/modules/exams/queries";
import { GenerateSeatingForm } from "@/modules/exam-seating/components/generate-form";
import { SeatGrid } from "@/modules/exam-seating/components/seat-grid";
import { getSeatingChart, listRoomOptions, listSeatingSlots } from "@/modules/exam-seating/queries";

export const metadata: Metadata = { title: "Exam seating" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pick = (v?: string) => (v && UUID.test(v) ? v : undefined);

// Exam seating. Reading needs `exam.seating.read`; generating needs `exam.manage`. The backend is real, no simulation.
export default async function ExamSeatingPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ exam?: string; plan?: string }> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "exam_seating");
  if (!hasPermission(ctx, "exam.seating.read")) throw new AppError("forbidden", "You do not have access to exam seating.");
  const canGenerate = hasPermission(ctx, "exam.manage");
  const examId = pick(sp.exam);
  const planId = pick(sp.plan);

  const [examsR, roomsR, slotsR, chartR] = await Promise.allSettled([
    listExams(ctx),
    canGenerate ? listRoomOptions(ctx) : Promise.resolve([]),
    examId ? listSeatingSlots(ctx, examId) : Promise.resolve(null),
    planId ? getSeatingChart(ctx, planId) : Promise.resolve(null),
  ]);
  for (const r of [examsR, roomsR, slotsR, chartR]) if (r.status === "rejected") console.error("exam seating fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const rooms = roomsR.status === "fulfilled" ? roomsR.value : [];
  const printHref = planId ? `/api/v1/query/examSeating.chartHtml?format=html&institution=${encodeURIComponent(slug)}&input=${encodeURIComponent(JSON.stringify({ planId }))}` : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Exam seating" description="Pick an exam, generate a seating plan for each paper slot, and print the room charts." />
      {examsR.status === "rejected" ? (
        <ErrorState title="Could not load exams" description="Refresh to try again." />
      ) : examsR.value.length === 0 ? (
        <EmptyState title="No exams yet" description="Create an exam and schedule its papers first." />
      ) : (
        <form method="get" className="flex items-end gap-2" role="search">
          <div>
            <Label htmlFor="seat-exam">Exam</Label>
            <select id="seat-exam" name="exam" defaultValue={examId ?? ""} className="block h-10 w-64 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Select an exam…</option>
              {examsR.value.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.termName})
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline">
            Show slots
          </Button>
        </form>
      )}

      {examId && slotsR.status === "rejected" && <ErrorState title="Could not load paper slots" description="Refresh to try again." />}
      {examId && slotsR.status === "fulfilled" && slotsR.value && (slotsR.value.length === 0 ? (
        <EmptyState title="No scheduled papers" description="Schedule this exam's papers (date and time) before generating seating." />
      ) : (
        slotsR.value.map((s) => (
          <Card key={s.slotStart}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {s.localDate} {s.localTime}
                {s.plan ? <Badge variant={s.plan.stale ? "outline" : "success"}>{s.plan.stale ? "Plan out of date" : `Plan v${s.plan.versionNo}`}</Badge> : <Badge variant="outline">No plan</Badge>}
                {s.started && <Badge variant="outline">Started</Badge>}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {s.sections.map((x) => x.label).join(", ")} · {s.paperCount} paper{s.paperCount === 1 ? "" : "s"} · {s.studentCount} students
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {s.plan && (
                <Link href={`/${slug}/exams/seating?exam=${examId}&plan=${s.plan.id}`} className="text-sm underline">
                  View seating ({s.plan.seatCount} seats)
                </Link>
              )}
              {canGenerate && !s.started && <GenerateSeatingForm institutionSlug={slug} examId={examId} slotStart={s.slotStart} studentCount={s.studentCount} rooms={rooms} hasPlan={Boolean(s.plan)} />}
              {canGenerate && s.started && <p className="text-sm text-muted-foreground">This slot has started; the plan can no longer be regenerated.</p>}
            </CardContent>
          </Card>
        ))
      ))}

      {planId && chartR.status === "rejected" && <ErrorState title="Could not load the seating chart" description="Refresh to try again." />}
      {planId && chartR.status === "fulfilled" && (chartR.value === null ? (
        <EmptyState title="Plan not found" description="It may have been replaced or you may not have access." />
      ) : (
        <section aria-labelledby="seat-chart" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="seat-chart" className="text-base font-semibold">
              {chartR.value.examName} · {chartR.value.localDate} {chartR.value.localTime} · v{chartR.value.versionNo}
              {!chartR.value.isCurrent && <Badge variant="outline" className="ml-2">Superseded</Badge>}
            </h2>
            {printHref && (
              <a href={printHref} target="_blank" rel="noreferrer" className="text-sm underline">
                Printable view
              </a>
            )}
          </div>
          <SeatGrid chart={chartR.value} />
        </section>
      ))}
    </div>
  );
}
