import { inr } from "@/lib/format";
import Link from "next/link";
import type { ReactNode } from "react";
import { Bell, CalendarDays, ClipboardList, GraduationCap, Megaphone, Sparkles, Wallet } from "lucide-react";
import { AnimatedNumber, Stagger, StaggerItem } from "@/components/motion";
import { ErrorState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { ActivityTimeline } from "@/components/widgets/activity-timeline";
import { KpiTile } from "@/components/widgets/kpi-widget";
import { ListWidget, type ListRow } from "@/components/widgets/list-widget";
import { TimetableWidget } from "@/components/widgets/timetable-widget";
import { TrendWidget } from "@/components/widgets/trend-widget";
import { Widget } from "@/components/widgets/widget";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { listStudentAssignments } from "@/modules/academics/assignments.queries";
import { mySubmissions } from "@/modules/academics/submissions.queries";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { attendanceTrend, getStudentAttendanceSummary } from "@/modules/attendance/queries";
import { UpcomingExams } from "@/modules/exams/components/UpcomingExams";
import { listResultsForStudent, upcomingExamsForStudent } from "@/modules/exams/queries";
import { streakText } from "@/modules/practice/components/PracticeHistory";
import { practiceProgress, STREAK_WINDOW_DAYS } from "@/modules/practice/queries";
import { listInvoicesForStudent } from "@/modules/finance/queries";
import { listMyNotifications } from "@/modules/notifications/queries";
import { GuardianOverview } from "@/modules/people/components/GuardianOverview";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { getCurrentTermId, getStudentProfile } from "@/modules/people/queries";
import { resolvePortalSelection } from "@/modules/people/portal";
import { timetableTodayFor } from "@/modules/timetable/queries";
import { listPublicEvents, listPublicNotices } from "@/modules/website/queries";

const TZ = "Asia/Kolkata";
const DAY_MS = 86_400_000;
const longDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const shortDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const istHour = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" });

function greeting(now: Date): string {
  const h = Number(istHour.format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// No submission data on AssignmentSummary, so the badge reflects the due date only.
function dueBadge(dueAt: string | null, now: Date): ListRow["badge"] {
  if (!dueAt) return { label: "No due date", variant: "secondary" };
  const ms = new Date(dueAt).getTime() - now.getTime();
  if (ms < 0) return { label: "Past due", variant: "destructive" };
  if (ms < 2 * DAY_MS) return { label: "Due soon", variant: "warning" };
  return { label: "Upcoming", variant: "info" };
}

function Failed({ title, icon }: { title: string; icon: ReactNode }) {
  return (
    <Widget title={title} icon={icon}>
      <ErrorState description="This section couldn't load. Refresh the page to try again." />
    </Widget>
  );
}

// T-034 — portal overview (F-STU-02/11), now a per-role dashboard. Every
// figure is for `selection.studentId` only; notices/events are the school's
// public rows and notifications are the caller's own.
export default async function PortalOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { student: studentParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "student.read");
  // Fix round 1 (packet rule 3) — each tile reads a different tab's data,
  // so each needs that tab's own permission check too, not just the page
  // floor above.
  requirePermission(ctx, "attendance.read");
  requirePermission(ctx, "finance.read");
  requirePermission(ctx, "exam.result.read");
  requirePermission(ctx, "assignment.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal`);
  // String() keeps TS from narrowing `role` away, so the shared code below still compiles for both roles.
  if (String(ctx.membership.role) === "guardian") {
    return (
      <>
        <PortalNav institutionSlug={institutionSlug} role="guardian" selection={selection} activeHref="" />
        <GuardianOverview ctx={ctx} institutionSlug={institutionSlug} selection={selection} />
      </>
    );
  }
  const profile = await getStudentProfile(ctx, selection.studentId);
  const termId = profile?.enrolment ? await getCurrentTermId(ctx, profile.enrolment.academicYearId) : null;

  // Extras never fail the page: each rejected one renders ErrorState in its own widget.
  const canNotifications = hasPermission(ctx, "notification.read");
  const canPractice = hasPermission(ctx, "practice.attempt") && isModuleEnabled(ctx, "practice");
  const extras = Promise.allSettled([
    isModuleEnabled(ctx, "website") ? listPublicNotices(ctx.institution.id, 4) : Promise.resolve([]),
    isModuleEnabled(ctx, "website") ? listPublicEvents(ctx.institution.id, 4) : Promise.resolve([]),
    canNotifications ? listMyNotifications(ctx, 5) : Promise.resolve([]),
    isModuleEnabled(ctx, "timetable") ? timetableTodayFor(ctx, selection.studentId) : Promise.resolve([]),
    isModuleEnabled(ctx, "attendance") ? attendanceTrend(ctx, { days: 30, studentId: selection.studentId }) : Promise.resolve([]),
    isModuleEnabled(ctx, "exams") ? upcomingExamsForStudent(ctx, selection.studentId, 60) : Promise.resolve([]),
    canPractice ? practiceProgress(ctx, selection.studentId) : Promise.resolve(null),
  ]);

  const studentView = ctx.membership.role !== "guardian";
  const [attendance, invoices, results, assignments, submissions] = await Promise.all([
    termId && isModuleEnabled(ctx, "attendance") ? getStudentAttendanceSummary(ctx, selection.studentId, termId) : Promise.resolve(null),
    isModuleEnabled(ctx, "fees") ? listInvoicesForStudent(ctx, selection.studentId) : Promise.resolve([]),
    isModuleEnabled(ctx, "exams") ? listResultsForStudent(ctx, selection.studentId) : Promise.resolve([]),
    isModuleEnabled(ctx, "assignments") ? listStudentAssignments(ctx, selection.studentId) : Promise.resolve([]),
    // Student branch only: submission state drives "pending" and the row badges.
    studentView && isModuleEnabled(ctx, "assignments") ? mySubmissions(ctx, selection.studentId) : Promise.resolve([]),
  ]);
  const submissionState = new Map(submissions.map((x) => [x.assignmentId, x.state]));
  const [notices, events, notifications, timetableR, trendR, examsR, practiceR] = await extras;

  // invoices.total / paid_total are numeric(12,2) rupees (finance/queries.ts), not paise.
  const outstanding = invoices.reduce((sum, inv) => sum + (inv.total - inv.paidTotal), 0);
  const latestResult = results[0] ?? null;
  const basePath = `/${institutionSlug}/portal`;
  const q = `?student=${selection.studentId}`;
  const isGuardian = ctx.membership.role === "guardian";
  const now = new Date();
  const firstName = profile?.firstName ?? selection.studentName.split(" ")[0];
  const classLabel = profile?.enrolment ? `Class ${profile.enrolment.gradeName}-${profile.enrolment.sectionName}` : null;
  const attendancePct = attendance ? Math.round(attendance.percentage * 10) / 10 : undefined;

  const isPending = (id: string) => !studentView || (submissionState.get(id) ?? "not_submitted") === "not_submitted";
  const upcoming = assignments.filter((a) => a.dueAt && new Date(a.dueAt).getTime() >= now.getTime() && isPending(a.id));
  const assignmentRows: ListRow[] = [...upcoming, ...assignments.filter((a) => !upcoming.includes(a))].slice(0, 5).map((a) => {
    const state = studentView ? submissionState.get(a.id) : undefined;
    return {
      id: a.id,
      title: a.title,
      meta: a.dueAt ? `Due ${shortDate.format(new Date(a.dueAt))}` : undefined,
      href: studentView ? `${basePath}/assignments/${a.id}${q}` : `${basePath}/assignments${q}`,
      badge:
        state === "graded"
          ? ({ label: "Graded", variant: "success" } as const)
          : state === "submitted"
            ? ({ label: "Submitted", variant: "info" } as const)
            : dueBadge(a.dueAt, now),
    };
  });
  const resultRows: ListRow[] = results.slice(0, 4).map((r) => ({
    id: r.examId,
    title: r.examName,
    meta: `${+r.percentage.toFixed(1)}% · ${r.total}/${r.maxTotal}`,
    href: `${basePath}/results${q}`,
    badge: { label: r.grade, variant: "outline" },
  }));
  const unpaid = invoices.filter((inv) => inv.total - inv.paidTotal > 0);
  const nextDue = unpaid.map((inv) => inv.dueOn).filter((d): d is string => d !== null).sort()[0];

  const feesHref = `${basePath}/fees${q}`;
  const kpis = [
    <KpiTile
      key="att"
      label="Attendance this term"
      value={attendance ? `${attendance.percentage.toFixed(2)}%` : "—"}
      animateTo={attendancePct}
      format="percent"
      sub={attendance ? `Warning below ${attendance.thresholds.warn}%` : "No term data yet"}
      href={`${basePath}/attendance${q}`}
    />,
    <KpiTile
      key="fees"
      label="Outstanding fees"
      value={inr(outstanding)}
      animateTo={outstanding}
      format="inr"
      sub={unpaid.length ? `${unpaid.length} unpaid invoice${unpaid.length === 1 ? "" : "s"}` : "All paid"}
      href={feesHref}
    />,
    <KpiTile
      key="res"
      label="Latest result"
      value={latestResult ? `${latestResult.grade}` : "—"}
      sub={latestResult?.examName ?? "No published results yet."}
      href={`${basePath}/results${q}`}
    />,
    <KpiTile
      key="asg"
      label="Assignments due"
      value={String(upcoming.length)}
      animateTo={upcoming.length}
      sub={studentView ? `${assignments.length - submissions.filter((x) => x.state !== "not_submitted").length} not yet submitted` : `${assignments.length} published in total`}
      href={`${basePath}/assignments${q}`}
    />,
  ];

  // M16 security review (LOW): the query resolves to [] (fulfilled), not
  // skipped, when the module is off, so gate the widget itself — same
  // permission-gated pattern as studyHelper below — instead of relying on
  // an always-empty/always-Failed result to hide it.
  const timetable =
    isModuleEnabled(ctx, "timetable") &&
    (timetableR.status === "fulfilled" ? (
      <TimetableWidget
        key="tt"
        title={isGuardian ? `${firstName}'s timetable today` : "Today's timetable"}
        description={classLabel ?? undefined}
        icon={<CalendarDays />}
        periods={timetableR.value}
      />
    ) : (
      <Failed key="tt" title="Today's timetable" icon={<CalendarDays />} />
    ));
  const homework = (
    <ListWidget
      key="asg"
      title={isGuardian ? "Homework" : "Pending assignments"}
      icon={<ClipboardList />}
      action={{ href: `${basePath}/assignments${q}`, label: "All assignments" }}
      rows={assignmentRows}
      emptyTitle={isGuardian ? "No assignments right now" : "Nothing pending"}
    />
  );
  const attendanceTrendWidget =
    isModuleEnabled(ctx, "attendance") &&
    (trendR.status === "fulfilled" ? (
      <TrendWidget
        key="trend"
        title="Attendance, last 30 days"
        description="Running attendance %, school days"
        data={trendR.value}
        unit="percent"
        action={{ href: `${basePath}/attendance${q}`, label: "Attendance" }}
      />
    ) : (
      <Failed key="trend" title="Attendance, last 30 days" icon={<CalendarDays />} />
    ));
  const latestResults = (
    <ListWidget key="res" title="Recent results" icon={<GraduationCap />} action={{ href: `${basePath}/results${q}`, label: "All results" }} rows={resultRows} emptyTitle="No published results yet" />
  );
  // GU-08 — ai.study is student-only (D32); a guardian never has it, so the
  // card simply doesn't render for them.
  const studyHelper = hasPermission(ctx, "ai.study") && (
    <Widget key="study" title="Study helper" icon={<Sparkles />} action={{ href: `${basePath}/study${q}`, label: "Open study helper" }}>
      <p className="text-sm text-muted-foreground">Ask about a topic, get notes, mindmaps, or practice.</p>
      {canPractice && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p className="text-sm tabular-nums text-muted-foreground">
            {practiceR.status === "fulfilled" && practiceR.value
              ? `${streakText(practiceR.value.streak)} (last ${STREAK_WINDOW_DAYS} days)`
              : "Practice streak unavailable"}
          </p>
          <Link href={`${basePath}/practice${q}`} className={buttonVariants({ variant: "outline", className: "min-h-10" })}>
            Practice
          </Link>
        </div>
      )}
    </Widget>
  );
  const upcomingExams = isModuleEnabled(ctx, "exams") && <UpcomingExams key="exams" papers={examsR.status === "fulfilled" ? examsR.value : null} />;
  const announcements =
    notices.status === "fulfilled" ? (
      <ListWidget
        key="ann"
        title={isGuardian ? "School announcements" : "Announcements"}
        icon={<Megaphone />}
        rows={notices.value.map((n) => ({ id: n.id, title: n.title, meta: shortDate.format(new Date(n.publishAt)) }))}
        emptyTitle="No announcements"
      />
    ) : (
      <Failed key="ann" title="Announcements" icon={<Megaphone />} />
    );
  const schoolEvents =
    events.status === "fulfilled" ? (
      <ListWidget
        key="evt"
        title="Events"
        icon={<CalendarDays />}
        rows={events.value.map((e) => ({ id: e.id, title: e.title, meta: [shortDate.format(new Date(e.startsAt)), e.location].filter(Boolean).join(" · ") }))}
        emptyTitle="No events scheduled"
      />
    ) : (
      <Failed key="evt" title="Events" icon={<CalendarDays />} />
    );
  const notificationFeed =
    canNotifications && isModuleEnabled(ctx, "notifications") &&
    (notifications.status === "fulfilled" ? (
      <ActivityTimeline
        key="ntf"
        title="Notifications"
        icon={<Bell />}
        action={{ href: `${basePath}/notifications${q}`, label: "All notifications" }}
        now={now}
        events={notifications.value.map((n) => ({ id: n.id, title: n.title, time: n.createdAt, meta: n.readAt ? undefined : "Unread" }))}
      />
    ) : (
      <Failed key="ntf" title="Notifications" icon={<Bell />} />
    ));
  const feesDue = (
    <Widget key="feesdue" title="Fees due" icon={<Wallet />}>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">
        <AnimatedNumber value={outstanding} format="inr" />
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {unpaid.length
          ? `${unpaid.length} unpaid invoice${unpaid.length === 1 ? "" : "s"}${nextDue ? ` · next due ${shortDate.format(new Date(nextDue))}` : ""}`
          : "Nothing outstanding."}
      </p>
      <Link href={feesHref} className={buttonVariants({ className: "mt-4" })}>
        View fees
      </Link>
    </Widget>
  );

  const sections = isGuardian
    ? [feesDue, attendanceTrendWidget, latestResults, homework, timetable, announcements, schoolEvents, notificationFeed]
    : [timetable, homework, upcomingExams, announcements, attendanceTrendWidget, latestResults, schoolEvents, notificationFeed, studyHelper];

  return (
    <>
      <PortalNav institutionSlug={institutionSlug} role={ctx.membership.role as "guardian" | "student"} selection={selection} activeHref="" canStudy={hasPermission(ctx, "ai.study")} />
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight">{isGuardian ? `${firstName}'s day` : `${greeting(now)}, ${firstName}`}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{[longDate.format(now), classLabel].filter(Boolean).join(" · ")}</p>
      </div>

      <Stagger className="grid gap-3 min-[375px]:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <StaggerItem key={k.key}>{k}</StaggerItem>
        ))}
      </Stagger>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">{sections}</div>
    </>
  );
}
