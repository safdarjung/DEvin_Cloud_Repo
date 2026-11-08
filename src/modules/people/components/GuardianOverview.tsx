import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, ClipboardList, Megaphone, NotebookPen, Wallet } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { KpiStrip, KpiTile } from "@/components/widgets/kpi-widget";
import { ListWidget, type ListRow } from "@/components/widgets/list-widget";
import { TimetableWidget } from "@/components/widgets/timetable-widget";
import { AnimatedList, InteractiveTrend, ProgressBar, RadialGauge } from "@/components/widgets/viz";
import { Widget } from "@/components/widgets/widget";
import type { TenantContext } from "@/lib/auth/types";
import { inr } from "@/lib/format";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listStudentAssignments } from "@/modules/academics/assignments.queries";
import {
  attendanceDailyCounts,
  attendanceTrend,
  getAttendanceSettings,
  percentageFromCounts,
  todayInInstitutionTimezone,
} from "@/modules/attendance/queries";
import { AckButton } from "@/modules/diary/components/AckButton";
import { diaryForStudent } from "@/modules/diary/queries";
import { UpcomingExams } from "@/modules/exams/components/UpcomingExams";
import { upcomingExamsForStudent } from "@/modules/exams/queries";
import { listInvoicesForStudent } from "@/modules/finance/queries";
import { getStudentProfile } from "@/modules/people/queries";
import type { PortalSelection } from "@/modules/people/portal";
import { timetableTodayFor } from "@/modules/timetable/queries";
import { listPublicEvents, listPublicNotices } from "@/modules/website/queries";

const TZ = "Asia/Kolkata";
const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const longDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const shortDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function Failed({ title, icon }: { title: string; icon: ReactNode }) {
  return (
    <Widget title={title} icon={icon}>
      <ErrorState description="This section couldn't load. Refresh the page to try again." />
    </Widget>
  );
}

/**
 * Guardian branch of the portal overview: what a parent needs first for the
 * selected child. `selection` comes from resolvePortalSelection (per-child
 * isolation); every query below is scoped to `selection.studentId` and RLS.
 */
export async function GuardianOverview({
  ctx,
  institutionSlug,
  selection,
}: {
  ctx: TenantContext;
  institutionSlug: string;
  selection: PortalSelection;
}) {
  const basePath = `/${institutionSlug}/portal`;
  const q = `?student=${selection.studentId}`;
  const studentId = selection.studentId;
  const now = new Date();
  const today = todayInInstitutionTimezone(ctx);
  const on = (m: Parameters<typeof isModuleEnabled>[1]) => isModuleEnabled(ctx, m);

  const [profile, invoices, assignments, diary, notices, events, timetable, trend, counts, exams] = await Promise.allSettled([
    getStudentProfile(ctx, studentId),
    on("fees") ? listInvoicesForStudent(ctx, studentId) : Promise.resolve([]),
    on("assignments") ? listStudentAssignments(ctx, studentId) : Promise.resolve([]),
    on("diary") ? diaryForStudent(ctx, studentId) : Promise.resolve([]),
    on("website") ? listPublicNotices(ctx.institution.id, 4) : Promise.resolve([]),
    on("website") ? listPublicEvents(ctx.institution.id, 4) : Promise.resolve([]),
    on("timetable") ? timetableTodayFor(ctx, studentId) : Promise.resolve([]),
    on("attendance") ? attendanceTrend(ctx, { days: WINDOW_DAYS, studentId }) : Promise.resolve([]),
    // Two consecutive 30-day windows in one read: [today-59, today-30] is the baseline, [today-29, today] is current.
    on("attendance")
      ? attendanceDailyCounts(ctx, { from: shiftDays(today, -(2 * WINDOW_DAYS - 1)), to: today, studentId })
      : Promise.resolve([]),
    on("exams") ? upcomingExamsForStudent(ctx, studentId, 60) : Promise.resolve([]),
  ]);

  const firstName = (profile.status === "fulfilled" && profile.value?.firstName) || selection.studentName.split(" ")[0];
  const enrol = profile.status === "fulfilled" ? profile.value?.enrolment : null;
  const classLabel = enrol ? `Class ${enrol.gradeName}-${enrol.sectionName}` : null;

  // Attendance today + change vs the previous 30 days.
  let todayStatus = "—";
  let todaySub = "No attendance data";
  const attThresholds = getAttendanceSettings(ctx).thresholds;
  let attendanceKpi: { value: string; animateTo?: number; sub: string; delta?: { value: number; label: string } } = {
    value: "—",
    sub: "No data yet",
  };
  if (counts.status === "fulfilled" && on("attendance")) {
    const { statuses } = getAttendanceSettings(ctx);
    const label = (code: string) => statuses.find((s) => s.code === code)?.label ?? code;
    const todayRow = counts.value.find((r) => r.date === today);
    todayStatus = todayRow ? label(todayRow.status) : "Not marked yet";
    todaySub = todayRow ? "Marked by the class teacher" : "Teacher has not taken attendance";

    const windowStart = shiftDays(today, -(WINDOW_DAYS - 1));
    const cur = percentageFromCounts(counts.value.filter((r) => r.date >= windowStart), statuses);
    const prev = percentageFromCounts(counts.value.filter((r) => r.date < windowStart), statuses);
    if (cur.totalInDenominator > 0) {
      const pct = Math.round(cur.percentage * 10) / 10;
      attendanceKpi = { value: `${pct}%`, animateTo: pct, sub: `Last ${WINDOW_DAYS} days` };
      if (prev.totalInDenominator > 0) {
        attendanceKpi.delta = {
          value: Math.round((cur.percentage - prev.percentage) * 10) / 10,
          label: `pts vs previous ${WINDOW_DAYS} days`,
        };
      } else {
        attendanceKpi.sub = `Last ${WINDOW_DAYS} days · no earlier period to compare`;
      }
    }
  }

  // Fees.
  const inv = invoices.status === "fulfilled" ? invoices.value : [];
  const unpaid = inv.filter((i) => i.total - i.paidTotal > 0);
  const outstanding = unpaid.reduce((sum, i) => sum + (i.total - i.paidTotal), 0);
  const nextDue = unpaid.map((i) => i.dueOn).filter((d): d is string => d !== null).sort()[0];
  const billed = inv.reduce((sum, i) => sum + i.total, 0);
  const paid = inv.reduce((sum, i) => sum + i.paidTotal, 0);

  // Homework: no submission data on the summary, so "due" means a future due date.
  const asg = assignments.status === "fulfilled" ? assignments.value : [];
  const upcoming = asg.filter((a) => a.dueAt && new Date(a.dueAt).getTime() >= now.getTime());
  const homeworkRows: ListRow[] = upcoming.slice(0, 5).map((a) => {
    const ms = new Date(a.dueAt as string).getTime() - now.getTime();
    return {
      id: a.id,
      title: a.title,
      meta: `Due ${shortDate.format(new Date(a.dueAt as string))}`,
      href: `${basePath}/assignments${q}`,
      badge: ms < 2 * DAY_MS ? { label: "Due soon", variant: "warning" } : undefined,
    };
  });

  // Teacher updates: entries needing acknowledgement first, then newest.
  const entries = diary.status === "fulfilled" ? diary.value : [];
  const needsAck = (e: (typeof entries)[number]) => e.requiresAck && !e.acknowledged;
  const updates = [...entries].sort((a, b) => Number(needsAck(b)) - Number(needsAck(a)) || b.entryDate.localeCompare(a.entryDate)).slice(0, 4);
  const awaitingAck = entries.filter(needsAck).length;
  const ackRequired = entries.filter((e) => e.requiresAck).length;

  return (
    <>
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight">{`${firstName}'s day`}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{[longDate.format(now), classLabel].filter(Boolean).join(" · ")}</p>
      </div>

      <KpiStrip className="md:[&>div]:grid-cols-4 xl:[&>div]:grid-cols-4">
        <KpiTile label="Attendance today" value={todayStatus} sub={todaySub} href={`${basePath}/attendance${q}`} />
        <KpiTile label="Attendance, 30-day rate" value={attendanceKpi.value} animateTo={attendanceKpi.animateTo} format="percent" sub={attendanceKpi.sub} delta={attendanceKpi.delta} href={`${basePath}/attendance${q}`} />
        <KpiTile
          label="Fees due"
          value={inr(outstanding)}
          animateTo={outstanding}
          format="inr"
          sub={unpaid.length ? `${unpaid.length} unpaid invoice${unpaid.length === 1 ? "" : "s"}${nextDue ? ` · next due ${shortDate.format(new Date(nextDue))}` : ""}` : "All paid"}
          href={`${basePath}/fees${q}`}
        />
        <KpiTile label="Homework due" value={String(upcoming.length)} animateTo={upcoming.length} sub={`${asg.length} published in total`} href={`${basePath}/assignments${q}`} />
      </KpiStrip>

      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {on("timetable") &&
          (timetable.status === "fulfilled" ? (
            <TimetableWidget className="lg:col-span-2" title={`${firstName}'s timetable today`} description={classLabel ?? undefined} icon={<CalendarDays />} periods={timetable.value} />
          ) : (
            <Failed title="Today's timetable" icon={<CalendarDays />} />
          ))}

        {on("diary") &&
          (diary.status === "fulfilled" ? (
            <Widget
              title="Teacher updates"
              description={awaitingAck ? `${awaitingAck} waiting for your acknowledgement` : undefined}
              icon={<NotebookPen />}
              action={{ href: `${basePath}/updates${q}`, label: "All updates" }}
              isEmpty={updates.length === 0}
              empty={<EmptyState title="No updates from teachers yet" />}
            >
              {ackRequired > 0 && (
                <ProgressBar
                  label="Acknowledged"
                  value={ackRequired - awaitingAck}
                  max={ackRequired}
                  valueLabel={`${ackRequired - awaitingAck} of ${ackRequired}`}
                  tone={awaitingAck === 0 ? "success" : "warning"}
                  className="mb-2"
                />
              )}
              <AnimatedList ariaLabel="Teacher updates" className="space-y-0 divide-y">
                {updates.map((e) => (
                  <div key={e.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        {shortDate.format(new Date(`${e.entryDate}T00:00:00Z`))}
                        {e.subject ? ` · ${e.subject.name}` : ""}
                      </p>
                      <p className="mt-0.5 line-clamp-3 text-sm">{e.body}</p>
                    </div>
                    {needsAck(e) && <AckButton institutionSlug={institutionSlug} studentId={studentId} entryId={e.id} />}
                  </div>
                ))}
              </AnimatedList>
            </Widget>
          ) : (
            <Failed title="Teacher updates" icon={<NotebookPen />} />
          ))}

        <Widget title="Fee status" icon={<Wallet />}>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{inr(outstanding)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {unpaid.length ? `Outstanding across ${unpaid.length} invoice${unpaid.length === 1 ? "" : "s"}.` : "Nothing outstanding."}
          </p>
          {billed > 0 && (
            <ProgressBar
              label="Paid so far"
              value={paid}
              max={billed}
              valueLabel={`${inr(paid)} of ${inr(billed)}`}
              tone={paid >= billed ? "success" : "default"}
              className="mt-4"
            />
          )}
          <Link href={`${basePath}/fees${q}`} className={buttonVariants({ className: "mt-4 min-h-10" })}>
            {unpaid.length ? "View and pay" : "View fees"}
          </Link>
        </Widget>

        <ListWidget
          title="Homework"
          icon={<ClipboardList />}
          action={{ href: `${basePath}/assignments${q}`, label: "All assignments" }}
          rows={homeworkRows}
          emptyTitle="No homework due"
        />

        {on("attendance") &&
          (trend.status === "fulfilled" ? (
            <Widget title="Attendance, last 30 days" description="Running attendance %, school days" action={{ href: `${basePath}/attendance${q}`, label: "Attendance" }}>
              {attendanceKpi.animateTo !== undefined && (
                <RadialGauge
                  value={attendanceKpi.animateTo}
                  label={`${firstName}, last ${WINDOW_DAYS} days`}
                  sublabel={`Warning below ${attThresholds.warn}%`}
                  thresholds={{ good: attThresholds.warn, warn: attThresholds.critical }}
                  size={72}
                  className="mb-3"
                />
              )}
              <InteractiveTrend
                title="Attendance, last 30 days"
                unit="percent"
                series={{ "30d": trend.value.map((p) => ({ label: p.label, value: p.value })) }}
                keys={[{ key: "value", label: "Attendance" }]}
                heightClass="h-48"
              />
            </Widget>
          ) : (
            <Failed title="Attendance, last 30 days" icon={<CalendarDays />} />
          ))}

        {on("exams") && <UpcomingExams papers={exams.status === "fulfilled" ? exams.value : null} />}

        {notices.status === "fulfilled" ? (
          <ListWidget
            title="School announcements"
            icon={<Megaphone />}
            rows={notices.value.map((n) => ({ id: n.id, title: n.title, meta: shortDate.format(new Date(n.publishAt)) }))}
            emptyTitle="No announcements"
          />
        ) : (
          <Failed title="School announcements" icon={<Megaphone />} />
        )}

        {events.status === "fulfilled" ? (
          <ListWidget
            title="Events"
            icon={<CalendarDays />}
            rows={events.value.map((e) => ({ id: e.id, title: e.title, meta: [shortDate.format(new Date(e.startsAt)), e.location].filter(Boolean).join(" · ") }))}
            emptyTitle="No events scheduled"
          />
        ) : (
          <Failed title="Events" icon={<CalendarDays />} />
        )}
      </div>
    </>
  );
}
