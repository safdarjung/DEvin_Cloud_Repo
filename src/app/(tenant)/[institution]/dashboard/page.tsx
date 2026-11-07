import type { ReactNode } from "react";
import Link from "next/link";
import { Banknote, CalendarCheck, ChevronRight, GraduationCap, UserPlus } from "lucide-react";
import { SimulatedBadge } from "@/components/honesty";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { AIInsightCard } from "@/components/widgets/ai-insight-card";
import { KpiStrip, KpiTile } from "@/components/widgets/kpi-widget";
import { ListWidget, type ListRow } from "@/components/widgets/list-widget";
import { QuickActions, type QuickAction } from "@/components/widgets/quick-actions";
import { StaffAvailabilityWidget } from "@/components/widgets/staff-availability-widget";
import { TrendWidget } from "@/components/widgets/trend-widget";
import { Widget } from "@/components/widgets/widget";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { humanize, inr } from "@/lib/format";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listEnquiriesByStage } from "@/modules/admissions/queries";
import { attendanceTrend } from "@/modules/attendance/queries";
import { repeatedAbsentees, sectionAttendanceToday } from "@/modules/attendance/command.queries";
import { calendarForRole } from "@/modules/calendar/queries";
import { pendingApprovals } from "@/modules/core/approvals.queries";
import { buildApprovalQueue } from "@/modules/core/approval-queue";
import { ApprovalsQueue } from "@/modules/core/components/dashboard/ApprovalsQueue";
import { CollectionsChart } from "@/modules/core/components/dashboard/CollectionsChart";
import { Feed, Panel, PanelEmpty, SectionBars, type FeedItem, type StatTileProps } from "@/modules/core/components/dashboard/command-center";
import { DailyBriefing } from "@/modules/core/components/dashboard/DailyBriefing";
import { FunnelChart } from "@/modules/core/components/dashboard/FunnelChart";
import { GradeDistributionChart } from "@/modules/core/components/dashboard/GradeDistributionChart";
import { formatINR, getDashboardData } from "@/modules/core/dashboard.queries";
import { listExams, listRecheckQueue, listSectionOptions } from "@/modules/exams/queries";
import { upcomingExamPapers } from "@/modules/exams/upcoming.queries";
import { forecastCards as realForecastCards } from "@/modules/forecasts/queries";
import { insightCards, priorityActions as realPriorityActions, riskIndicators as realRiskIndicators } from "@/modules/insights/derived";
import { CommandGrid, type GridCard } from "@/modules/fabric/components/command/command-grid";
import { ForecastCards } from "@/modules/fabric/components/command/forecast-cards";
import { PriorityActionsWidget } from "@/modules/fabric/components/command/priority-actions";
import { RiskIndicators } from "@/modules/fabric/components/command/risk-indicators";
import { examStatusVariant, recheckStatusVariant } from "@/modules/exams/status";
import { listDefaulters } from "@/modules/finance/queries";
import { staffAvailabilityToday } from "@/modules/people/hr.queries";
import { peopleCounts } from "@/modules/people/counts.queries";
import { studentLeaveRequests } from "@/modules/student-leave/queries";
import { listPublicEvents, listPublicNotices } from "@/modules/website/queries";
import { cn } from "cn";

const TZ = "Asia/Kolkata";
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" });
const longDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const eventDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// 12-col desktop grid, 2-col tablet, 1-col phone. Pairs are 7/5 or 6/6.
const WIDE = "lg:col-span-7";
const NARROW = "lg:col-span-5";
const HALF = "lg:col-span-6";
const FULL = "md:col-span-2 lg:col-span-12";

/** "just now" / "5m ago" / "3h ago", else the short date. */
const ASK_PROMPTS = [
  "Summarize today's school operations",
  "Which classes have the lowest attendance?",
  "What is waiting for my approval?",
  "Identify students with repeated absences",
];

function ago(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  return shortDate.format(new Date(iso));
}

const value = <T,>(r: PromiseSettledResult<T | null>): T | null => (r.status === "fulfilled" ? r.value : null);
const failed = (r: PromiseSettledResult<unknown>): boolean => r.status === "rejected";

function FailedWidget({ title, className }: { title: string; className?: string }) {
  return (
    <Widget title={title} className={className}>
      <ErrorState title={`Couldn't load ${title.toLowerCase()}`} description="The rest of the dashboard is unaffected. Refresh to try again." />
    </Widget>
  );
}

function Insights({ items, className }: { items: Awaited<ReturnType<typeof insightCards>>; className?: string }) {
  return (
    <section aria-labelledby="insights" className={cn("min-w-0 space-y-3", className)}>
      <h2 id="insights" className="text-sm font-medium">
        Insights for today
      </h2>
      <div className="@container">
        <div className="grid gap-3 @xl:grid-cols-2">
          {items.map((i) => (
            <AIInsightCard key={i.title} {...i} />
          ))}
        </div>
      </div>
    </section>
  );
}

// KpiStrip defaults to 6 columns on xl; fit the column count to the tiles shown.
const STRIP_COLS: Record<number, string> = {
  1: "md:[&>div]:grid-cols-1 xl:[&>div]:grid-cols-1",
  2: "md:[&>div]:grid-cols-2 xl:[&>div]:grid-cols-2",
  3: "md:[&>div]:grid-cols-3 xl:[&>div]:grid-cols-3",
  4: "md:[&>div]:grid-cols-4 xl:[&>div]:grid-cols-4",
};

function Kpis({ items }: { items: ReactNode[] }) {
  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <KpiStrip className={cn(FULL, STRIP_COLS[Math.min(shown.length, 4)])}>{shown}</KpiStrip>
  );
}

// T-039 — role-aware dashboard (07 §2.2 `dashboard.view`; finance tiles need
// `finance.read`). `requirePermission` below is the gate: a role without
// `dashboard.view` (e.g. teacher) never reaches `getDashboardData` or any
// extra fetch, so none of these aggregates are ever computed for them
// (CLAUDE.md rule 2). Every extra fetch is also gated on its read permission.
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");

  const role = ctx.membership.role;
  const isLeader = role !== "admissions" && role !== "accountant" && role !== "exam_controller";
  // RLS returns nothing without the module's read permission, so hide the
  // section instead of showing a misleading "no data" state.
  const canAttendance = hasPermission(ctx, "attendance.read");
  const canEnquiries = hasPermission(ctx, "admissions.enquiry.read");
  const canResults = hasPermission(ctx, "exam.result.read");
  const canRechecks = hasPermission(ctx, "exam.recheck.review");
  // Fix round 1 (security review, LOW-4): accountant/exam_controller have
  // `dashboard.view` but not `ai.generate` — never render the button for a
  // role that can only get `forbidden` back from the route.
  const canGenerateBriefing = hasPermission(ctx, "ai.generate");
  const showWebsite = isLeader || role === "admissions";

  // Optional per-widget extras: started before the dashboard aggregate so they
  // run in parallel; allSettled so one failure is one ErrorState, not a crash.
  const skip = Promise.resolve(null);
  const extrasP = Promise.allSettled([
    showWebsite && isModuleEnabled(ctx, "website") ? listPublicNotices(ctx.institution.id, 4) : skip,
    // shortcut: listPublicEvents has no date filter, so take 20 and keep upcoming; upgrade if a school has >20 past public events.
    showWebsite && isModuleEnabled(ctx, "website") ? listPublicEvents(ctx.institution.id, 20) : skip,
    (isLeader || role === "exam_controller") && canRechecks && isModuleEnabled(ctx, "exams") ? listRecheckQueue(ctx, "submitted") : skip,
    role === "exam_controller" && canResults && isModuleEnabled(ctx, "exams") ? listExams(ctx) : skip,
    role === "admissions" && canEnquiries && isModuleEnabled(ctx, "admissions") ? listEnquiriesByStage(ctx) : skip,
    isLeader && canAttendance ? attendanceTrend(ctx, { days: 42 }) : skip,
    isLeader ? pendingApprovals(ctx) : skip,
    isLeader && hasPermission(ctx, "staff.read") && isModuleEnabled(ctx, "staff_attendance") ? staffAvailabilityToday(ctx) : skip,
    isLeader && canAttendance ? sectionAttendanceToday(ctx) : skip,
    isLeader && hasPermission(ctx, "student.read") && hasPermission(ctx, "staff.read") ? peopleCounts(ctx) : skip,
    isLeader ? listSectionOptions(ctx).then((r) => r.length) : skip,
    isLeader && hasPermission(ctx, "student_leave.approve") && isModuleEnabled(ctx, "student_leave") ? studentLeaveRequests(ctx, { status: "pending", limit: 50 }) : skip,
    isLeader && canResults && isModuleEnabled(ctx, "exams") ? upcomingExamPapers(ctx, new Date().toISOString(), 5) : skip,
    isLeader && hasPermission(ctx, "academics.read") && isModuleEnabled(ctx, "calendar") ? calendarForRole(ctx, {}) : skip,
    isLeader && role !== "admin" && canAttendance ? repeatedAbsentees(ctx, { days: 14, minAbsences: 3, limit: 5 }) : skip,
  ]);
  const data = await getDashboardData(ctx);
  const termId = data.collections?.termId;
  const [defaultersR] = await Promise.allSettled([(isLeader || role === "accountant") && termId ? listDefaulters(ctx, { termId }) : skip]);
  const [noticesR, eventsR, rechecksR, examsR, enquiriesR, trendR, approvalsR, staffR, sectionAttR, countsR, sectionCountR, studentLeaveR, upcomingExamsR, calendarR, absenteesR] = await extrasP;
  for (const r of [noticesR, eventsR, rechecksR, examsR, enquiriesR, trendR, approvalsR, staffR, sectionAttR, countsR, sectionCountR, studentLeaveR, upcomingExamsR, calendarR, absenteesR, defaultersR]) {
    if (r.status === "rejected") console.error("dashboard widget fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  }

  const now = new Date();
  const basePath = `/${institutionSlug}`;
  const todayIso = now.toLocaleDateString("en-CA", { timeZone: TZ });

  const hour = Number(hourFmt.format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = ctx.user.profile.fullName?.trim().split(/\s+/)[0];

  const enrolledCount = data.funnel.applicationStatuses.enrolled ?? 0;
  const openEnquiries = Object.values(data.funnel.enquiryStages).reduce((sum, n) => sum + n, 0);
  const collections = data.collections;
  const outstandingPaise = collections ? Math.max(collections.duePaise - collections.collectedPaise, 0) : 0;
  const collectionPct = collections && collections.duePaise > 0 ? Math.round((collections.collectedPaise / collections.duePaise) * 1000) / 10 : null;

  const defaulters = value(defaultersR);
  const overdue = defaulters?.filter((d) => d.dueOn !== null && d.dueOn < todayIso) ?? [];
  const rechecks = value(rechecksR);
  const exams = value(examsR);
  const notices = value(noticesR);
  const events = value(eventsR)
    ?.filter((e) => (e.endsAt ?? e.startsAt) >= now.toISOString())
    .slice(0, 4);

  // Insight/forecast data (demo tenant included). Gated on permission + module flag; a
  // rejected query becomes a FailedWidget, never a fabricated number.
  const canInsights = hasPermission(ctx, "insight.read");
  const canForecasts = hasPermission(ctx, "forecast.read");
  const insightsOn = canInsights && isModuleEnabled(ctx, "insights");
  const forecastsOn = canForecasts && isModuleEnabled(ctx, "forecasts");
  const [prioR, riskR, cardsR, forecastR] = await Promise.allSettled([
    insightsOn ? realPriorityActions(ctx) : skip,
    insightsOn ? realRiskIndicators(ctx) : skip,
    insightsOn ? insightCards(ctx, { limit: 4 }) : skip,
    forecastsOn ? realForecastCards(ctx) : skip,
  ]);
  for (const r of [prioR, riskR, cardsR, forecastR]) {
    if (r.status === "rejected") console.error("dashboard insight/forecast fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  }
  const realCards = value(cardsR);

  const insights = realCards && realCards.length > 0 ? realCards : null;

  const icon = "size-4";
  const quickActions = (
    [
      hasPermission(ctx, "admissions.enquiry.write") && { href: `${basePath}/admissions`, label: "New enquiry", icon: <UserPlus className={icon} /> },
      hasPermission(ctx, "finance.payment.record") && { href: `${basePath}/finance/invoices`, label: "Record payment", icon: <Banknote className={icon} /> },
      hasPermission(ctx, "attendance.mark") && { href: `${basePath}/attendance`, label: "Mark attendance", icon: <CalendarCheck className={icon} /> },
      hasPermission(ctx, "exam.manage") && { href: `${basePath}/exams/new`, label: "New exam", icon: <GraduationCap className={icon} /> },
    ] satisfies (QuickAction | false)[]
  ).filter((a) => a !== false);

  // ---- shared widgets (each null when its permission/data is absent) -------

  const briefing = canGenerateBriefing && (
    <DailyBriefing
      institutionSlug={institutionSlug}
      attendancePercent={canAttendance ? data.attendanceToday.percentage : undefined}
      sectionsAtRiskCount={canAttendance ? data.sectionsAtRisk.length : undefined}
      openEnquiries={openEnquiries}
      enrolledCount={enrolledCount}
      collections={collections ? { collectedPaise: collections.collectedPaise, duePaise: collections.duePaise } : null}
    />
  );
  const actions = (className?: string) => <QuickActions actions={quickActions} className={className} />;

  const enquiryKpi = canEnquiries && isModuleEnabled(ctx, "admissions") && (
    <KpiTile label="Open enquiries" value={String(openEnquiries)} animateTo={openEnquiries} sub={`${enrolledCount} enrolled this year`} href={`${basePath}/admissions`} />
  );
  const collectedKpi = collections && (
    <KpiTile
      label="Collected this term"
      value={formatINR(collections.collectedPaise)}
      animateTo={collections.collectedPaise / 100}
      format="inr"
      sub={`of ${formatINR(collections.duePaise)} due`}
      href={`${basePath}/finance`}
    />
  );

  const collectionsChart = (className: string) =>
    collections && (
      <Widget title="Fee collection this term" action={{ href: `${basePath}/finance`, label: "Finance" }} className={className}>
        <CollectionsChart collectedPaise={collections.collectedPaise} duePaise={collections.duePaise} />
      </Widget>
    );
  const funnel = (className: string) =>
    canEnquiries && isModuleEnabled(ctx, "admissions") && (
      <Widget title="Admissions funnel" action={{ href: `${basePath}/admissions`, label: "Pipeline" }} className={cn("md:col-span-2", className)}>
        <FunnelChart funnel={data.funnel} />
      </Widget>
    );
  const gd = data.gradeDistribution;
  const grades = (className: string) =>
    canResults && isModuleEnabled(ctx, "exams") && (
      <Widget
        title="Exam grade distribution"
        description={gd ? `${gd.examName} — ${gd.total} results` : undefined}
        isEmpty={!gd}
        empty={<EmptyState title="No published exam yet" description="Grade distribution appears once results are published." />}
        className={className}
      >
        {gd && <GradeDistributionChart distribution={gd.distribution} />}
      </Widget>
    );
  const recheckQueue = (className: string) =>
    failed(rechecksR) ? (
      <FailedWidget title="Recheck requests" className={className} />
    ) : (
      rechecks && (
        <ListWidget
          title="Recheck requests"
          description={`${rechecks.length} waiting for review`}
          action={{ href: `${basePath}/exams/rechecks`, label: "Review all" }}
          emptyTitle="No recheck requests waiting"
          rows={rechecks.slice(0, 5).map((r) => ({
            id: r.id,
            title: r.studentName,
            meta: `${r.subjectName} · ${r.examName}`,
            href: `${basePath}/exams/rechecks/${r.id}`,
            badge: { label: humanize(r.status), variant: recheckStatusVariant(r.status) },
          }))}
          className={className}
        />
      )
    );
  const canEditWebsite = hasPermission(ctx, "website.edit");
  const website = showWebsite && (
    <>
      {failed(eventsR) ? (
        <FailedWidget title="Upcoming events" className={HALF} />
      ) : (
        <ListWidget
          title="Upcoming events"
          action={canEditWebsite ? { href: `${basePath}/website/events`, label: "Events" } : undefined}
          emptyTitle="No upcoming public events"
          rows={(events ?? []).map((e) => ({ id: e.id, title: e.title, meta: [eventDate.format(new Date(e.startsAt)), e.location].filter(Boolean).join(" · ") }))}
          className={HALF}
        />
      )}
      {failed(noticesR) ? (
        <FailedWidget title="Latest notices" className={HALF} />
      ) : (
        <ListWidget
          title="Latest notices"
          action={canEditWebsite ? { href: `${basePath}/website/notices`, label: "Notices" } : undefined}
          emptyTitle="No public notices"
          rows={(notices ?? []).map((n) => ({ id: n.id, title: n.title, meta: shortDate.format(new Date(n.publishAt)) }))}
          className={HALF}
        />
      )}
    </>
  );
  const defaultersFailed = failed(defaultersR);

  // ---- per-role layouts ----------------------------------------------------

  let body: ReactNode;
  let showHeader = true;
  if (role === "admissions") {
    const enquiryRows: ListRow[] = Object.values(value(enquiriesR) ?? {})
      .flat()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        title: e.childName,
        meta: `${e.guardianName} · ${shortDate.format(new Date(e.createdAt))}`,
        href: `${basePath}/admissions/enquiries/${e.id}`,
        badge: { label: humanize(e.status), variant: "outline" },
      }));
    body = (
      <>
        <Kpis
          items={[
            enquiryKpi,
            canEnquiries && isModuleEnabled(ctx, "admissions") && <KpiTile label="Enrolled this year" value={String(enrolledCount)} animateTo={enrolledCount} href={`${basePath}/admissions/applications`} />,
          ]}
        />
        {funnel(WIDE)}
        <div className={cn("min-w-0 space-y-4", NARROW)}>
          {quickActions.length > 0 && actions()}
          {failed(enquiriesR) ? (
            <FailedWidget title="Newest enquiries" />
          ) : (
            canEnquiries && isModuleEnabled(ctx, "admissions") && (
              <ListWidget
                title="Newest enquiries"
                action={{ href: `${basePath}/admissions`, label: "All enquiries" }}
                emptyTitle="No enquiries yet"
                rows={enquiryRows}
              />
            )
          )}
        </div>
        {insights && <Insights items={insights} className={briefing ? WIDE : FULL} />}
        {briefing && <div className={insights ? NARROW : FULL}>{briefing}</div>}
        {website}
      </>
    );
  } else if (role === "accountant") {
    const topDefaulters = [...(defaulters ?? [])].sort((a, b) => b.outstanding - a.outstanding).slice(0, 5);
    body = collections ? (
      <>
        <Kpis
          items={[
            collectedKpi,
            <KpiTile key="outstanding" label="Outstanding" value={formatINR(outstandingPaise)} animateTo={outstandingPaise / 100} format="inr" sub={`of ${formatINR(collections.duePaise)} due this term`} href={`${basePath}/finance/defaulters`} />,
            <KpiTile
              key="collection-rate"
              label="Collection rate"
              value={collectionPct === null ? "—" : `${collectionPct}%`}
              animateTo={collectionPct ?? undefined}
              format="percent"
              sub={`${collections.invoiceCount} invoices this term`}
            />,
          ]}
        />
        {quickActions.length > 0 && actions(FULL)}
        {collectionsChart(NARROW)}
        {defaultersFailed ? (
          <FailedWidget title="Top defaulters" className={WIDE} />
        ) : (
          <ListWidget
            title="Top defaulters"
            description={`${defaulters?.length ?? 0} unpaid invoices, ${overdue.length} overdue`}
            action={{ href: `${basePath}/finance/defaulters`, label: "All defaulters" }}
            emptyTitle="No unpaid invoices this term"
            rows={topDefaulters.map((d) => ({
              id: d.invoiceId,
              title: d.studentName,
              meta: `${inr(d.outstanding)} outstanding · ${d.invoiceNo}${d.dueOn ? ` · due ${shortDate.format(new Date(d.dueOn))}` : ""}`,
              href: `${basePath}/finance/invoices/${d.invoiceId}`,
              badge: d.dueOn !== null && d.dueOn < todayIso ? { label: "Overdue", variant: "destructive" } : undefined,
            }))}
            className={WIDE}
          />
        )}
        {insights && <Insights items={insights} className={FULL} />}
      </>
    ) : (
      <>
        <Widget title="Fee collection this term" className={FULL}>
          <EmptyState title="No current term" description="Collections appear once the current academic year has a term with invoices." />
        </Widget>
        {quickActions.length > 0 && actions(NARROW)}
      </>
    );
  } else if (role === "exam_controller") {
    const byStatus = (s: string) => exams?.filter((e) => e.status === s).length ?? 0;
    body = (
      <>
        <Kpis
          items={[
            exams && <KpiTile label="In marks entry" value={String(byStatus("marks_entry"))} animateTo={byStatus("marks_entry")} sub={`${byStatus("draft")} in draft`} href={`${basePath}/exams`} />,
            exams && <KpiTile label="In verification" value={String(byStatus("verification"))} animateTo={byStatus("verification")} href={`${basePath}/exams`} />,
            exams && <KpiTile label="Published" value={String(byStatus("published"))} animateTo={byStatus("published")} href={`${basePath}/exams`} />,
            rechecks && <KpiTile label="Pending rechecks" value={String(rechecks.length)} animateTo={rechecks.length} href={`${basePath}/exams/rechecks`} />,
          ]}
        />
        {grades(NARROW)}
        {recheckQueue(WIDE)}
        {failed(examsR) ? (
          <FailedWidget title="Exams" className={WIDE} />
        ) : (
          exams && (
            <ListWidget
              title="Exams"
              action={{ href: `${basePath}/exams`, label: "All exams" }}
              emptyTitle="No exams yet"
              rows={exams.slice(0, 6).map((e) => ({
                id: e.id,
                title: e.name,
                meta: [e.termName, humanize(e.type)].filter(Boolean).join(" · "),
                href: `${basePath}/exams/${e.id}`,
                badge: { label: humanize(e.status), variant: examStatusVariant(e.status) },
              }))}
              className={WIDE}
            />
          )
        )}
        <div className={cn("min-w-0 space-y-4", NARROW)}>
          {actions()}
          {insights && <Insights items={insights} />}
        </div>
      </>
    );
  } else {
    // Leader command center (owner / principal / admin). Operational first:
    // KPI strip, approvals, class attendance, activity, upcoming. Every figure
    // comes from a query above; a missing permission/module drops the tile.
    const isAdminRole = role === "admin";
    showHeader = false;

    const trendPts = value(trendR) ?? [];
    const sectionAtt = value(sectionAttR);
    const counts = value(countsR);
    const sectionCount = value(sectionCountR);
    const studentLeaves = value(studentLeaveR);
    const upcomingExams = value(upcomingExamsR);
    const calendar = value(calendarR);
    const absentees = value(absenteesR);
    const approvalRows = value(approvalsR);
    const queue = approvalRows || studentLeaves ? buildApprovalQueue(approvalRows ?? [], studentLeaves ?? [], now.getTime()) : null;
    const marked = data.attendanceToday.totalInDenominator;
    const inrWhole = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

    const tiles: StatTileProps[] = [];
    if (counts) {
      tiles.push({ label: "Students", value: counts.students.toLocaleString("en-IN"), href: `${basePath}/students` });
      tiles.push({ label: "Staff", value: counts.staff.toLocaleString("en-IN") });
    }
    if (sectionCount !== null) tiles.push({ label: "Sections", value: String(sectionCount) });
    if (canAttendance) {
      tiles.push({
        label: "Attendance today",
        value: marked > 0 ? `${data.attendanceToday.percentage}%` : "—",
        sub: marked > 0 ? `${marked} students marked` : "Not marked yet",
        href: `${basePath}/attendance`,
      });
      if (sectionAtt) tiles.push({ label: "Absent today", value: marked > 0 ? String(sectionAtt.absentTotal) : "—", sub: marked > 0 ? `${data.sectionsAtRisk.length} sections below threshold` : undefined });
    }
    if (queue) tiles.push({ label: "Approvals waiting", value: String(queue.total), sub: queue.total === 0 ? "Nothing to decide" : undefined });
    if (collections) tiles.push({ label: "Collected this term", value: inrWhole(collections.collectedPaise), sub: `of ${inrWhole(collections.duePaise)} due`, href: `${basePath}/finance` });
    if (defaulters) tiles.push({ label: "Overdue invoices", value: String(overdue.length), href: `${basePath}/finance/defaulters` });
    if (canEnquiries && isModuleEnabled(ctx, "admissions")) tiles.push({ label: "Open enquiries", value: String(openEnquiries), sub: `${enrolledCount} enrolled this year`, href: `${basePath}/admissions` });
    if (upcomingExams) tiles.push({ label: "Upcoming exams", value: String(upcomingExams.total), sub: upcomingExams.papers[0] ? `Next ${shortDate.format(new Date(upcomingExams.papers[0].scheduledAt))}` : undefined, href: `${basePath}/exams` });

    // ---- panels ----
    const approvalsPanel = failed(approvalsR) ? (
      <FailedWidget title="Pending approvals" />
    ) : (
      queue && (
        <Panel title="Pending approvals" count={queue.total ? String(queue.total) : undefined}>
          {queue.items.length === 0 ? (
            <PanelEmpty title="No approvals waiting" hint="Leave and recheck requests that need a decision appear here." />
          ) : (
            <ApprovalsQueue
              institutionSlug={institutionSlug}
              items={queue.items}
              total={queue.total}
              canDecideStaffLeave={hasPermission(ctx, "leave.approve")}
              canDecideStudentLeave={hasPermission(ctx, "student_leave.approve")}
            />
          )}
        </Panel>
      )
    );

    const sectionPanel = canAttendance && (
      failed(sectionAttR) ? (
        <FailedWidget title="Section attendance" />
      ) : (
        <Panel title="Section attendance" count="lowest first" action={{ href: `${basePath}/attendance`, label: "Attendance" }}>
          {!sectionAtt || sectionAtt.sections.length === 0 ? (
            <PanelEmpty
              title="No attendance marked today"
              hint="Sections appear once a class teacher submits today's register."
              action={hasPermission(ctx, "attendance.mark") ? { href: `${basePath}/attendance`, label: "Mark attendance" } : undefined}
            />
          ) : (
            <SectionBars
              threshold={75}
              rows={sectionAtt.sections.slice(0, 7).map((s) => ({ id: s.classSectionId, label: s.label, percentage: s.percentage, absent: s.absent, href: `${basePath}/attendance/${s.classSectionId}` }))}
            />
          )}
        </Panel>
      )
    );

    const activityPanel = data.recentActivity !== null && (
      <Panel title="Recent activity" action={ctx.permissions.has("notification.log.read") ? { href: `${basePath}/notifications/log`, label: "Message log" } : undefined}>
        {data.recentActivity.length === 0 ? (
          <PanelEmpty title="No messages sent yet" hint="Attendance and fee notifications are logged here." />
        ) : (
          <>
            {data.recentActivity.slice(0, 6).some((e) => e.status === "simulated") && <SimulatedBadge />}
            <Feed items={data.recentActivity.slice(0, 6).map((e) => ({ id: e.id, title: e.renderedBody, meta: humanize(e.channel), time: ago(e.attemptedAt, now) }))} />
          </>
        )}
      </Panel>
    );

    const upcomingItems: (FeedItem & { date: string })[] = [
      ...(upcomingExams?.papers ?? []).map((p) => ({ id: `paper-${p.id}`, date: p.scheduledAt, title: `${p.examName}: ${p.subjectName}`, meta: `${p.section} · Exam`, time: shortDate.format(new Date(p.scheduledAt)), href: `${basePath}/exams/${p.examId}` })),
      ...(calendar ?? [])
        .filter((e) => e.kind !== "holiday")
        .map((e) => ({ id: `cal-${e.id}`, date: e.startsOn, title: e.title, meta: humanize(e.kind), time: shortDate.format(new Date(e.startsOn)) })),
      ...(calendar ? [] : (events ?? []).map((e) => ({ id: `evt-${e.id}`, date: e.startsAt, title: e.title, meta: [eventDate.format(new Date(e.startsAt)), e.location].filter(Boolean).join(" · "), time: shortDate.format(new Date(e.startsAt)) }))),
    ]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 6);
    const upcomingPanel = (
      <Panel title="Upcoming events and exams" action={canEditWebsite ? { href: `${basePath}/website/events`, label: "Manage events" } : undefined}>
        {upcomingItems.length === 0 ? (
          <PanelEmpty title="Nothing scheduled" hint="Exam papers and calendar events show here once they are scheduled." />
        ) : (
          <Feed items={upcomingItems} />
        )}
      </Panel>
    );

    const trendPanel = <TrendWidget title="Attendance performance" description="School-wide attendance by school day" unit="percent" data={trendPts} />;
    const staffToday = value(staffR);
    const staffPanel = failed(staffR) ? <FailedWidget title="Staff today" /> : staffToday && <StaffAvailabilityWidget title="Staff today" description="Self check-ins are self-reported" {...staffToday} />;

    const quickPanel = quickActions.length > 0 && <QuickActions actions={quickActions} />;

    const absenteesPanel = !isAdminRole && canAttendance && (
      failed(absenteesR) ? (
        <FailedWidget title="Repeated absentees" />
      ) : (
        <Panel title="Repeated absentees" count="last 14 days">
          {!absentees || absentees.length === 0 ? (
            <PanelEmpty title="No repeated absences" hint="Students absent 3 or more days in the last 14 appear here." />
          ) : (
            <Feed items={absentees.map((s) => ({ id: s.studentId, title: s.name, meta: s.classSection, time: `${s.absences} days`, href: `${basePath}/students/${s.studentId}` }))} />
          )}
        </Panel>
      )
    );

    // "Ask the data" entry point: same gate as the sidebar's /assistant link
    // (dashboard.view + ai_teacher module; see src/lib/nav.ts). The assistant
    // reads no ?q= param, so prompts are plain links shown as hints.
    const askPanel = hasPermission(ctx, "dashboard.view") && isModuleEnabled(ctx, "ai_teacher") && (
      <Panel title="Ask the data" action={{ href: `${basePath}/assistant`, label: "Open assistant" }}>
        <p className="text-xs text-muted-foreground">Questions you can ask the assistant:</p>
        <ul className="-mx-2">
          {ASK_PROMPTS.map((prompt) => (
            <li key={prompt}>
              <Link
                href={`${basePath}/assistant`}
                className="flex min-h-11 items-center justify-between gap-2 rounded-md px-2 text-sm transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">{prompt}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    );

    // Lower grid: everything that is not first-screen, still reorderable.
    const cards: GridCard[] = [];
    const add = (id: string, title: string, span: string, node: ReactNode) => node && cards.push({ id, title, span, node });
    if (canInsights || canForecasts) {
      const off = (title: string, d: string) => (
        <Widget title={title}>
          <EmptyState title={`No ${title.toLowerCase()} yet`} description={d} />
        </Widget>
      );
      const PLAN_OFF = "This module is not turned on for your school. An owner can enable it in Settings > Modules.";
      if (canInsights) {
        const prio = value(prioR);
        const risks = value(riskR);
        add("priorities", "Priorities", NARROW, !insightsOn ? off("Priorities", PLAN_OFF) : failed(prioR) ? <FailedWidget title="Priorities" /> : <PriorityActionsWidget actions={(prio ?? []).slice(0, 5)} base={basePath} />);
        add("risks", "Risks", NARROW, !insightsOn ? off("Risks", PLAN_OFF) : failed(riskR) ? <FailedWidget title="Risks" /> : risks && risks.length > 0 ? <RiskIndicators risks={risks} base={basePath} /> : off("Risks", "Risk indicators appear once insights are detected."));
        add("insights", "Insights", FULL, !insightsOn ? off("Insights", PLAN_OFF) : failed(cardsR) ? <FailedWidget title="Insights" /> : insights ? <Insights items={insights} /> : off("Insights", "Nothing has been detected yet."));
      }
      if (canForecasts) {
        const fc = value(forecastR);
        add("forecasts", "Forecasts", FULL, !forecastsOn ? off("Forecasts", PLAN_OFF) : failed(forecastR) ? <FailedWidget title="Forecasts" /> : fc && fc.length > 0 ? <ForecastCards cards={fc} base={basePath} /> : off("Forecasts", "Forecasts appear once enough history is recorded."));
      }
    }
    add("funnel", "Admissions funnel", WIDE, funnel(""));
    add("collections", "Fee collection", NARROW, collectionsChart(""));
    if (isAdminRole) add("grades", "Grades", NARROW, grades(""));
    if (isAdminRole) add("assistant", "AI briefing", NARROW, briefing);
    add(
      "notices",
      "Latest notices",
      WIDE,
      showWebsite &&
        (failed(noticesR) ? (
          <FailedWidget title="Latest notices" />
        ) : (
          <ListWidget
            title="Latest notices"
            action={canEditWebsite ? { href: `${basePath}/website/notices`, label: "Notices" } : undefined}
            emptyTitle="No public notices"
            rows={(notices ?? []).map((n) => ({ id: n.id, title: n.title, meta: shortDate.format(new Date(n.publishAt)) }))}
          />
        )),
    );

    body = (
      <div className={cn(FULL, "space-y-4")}>
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{firstName ? `${greeting}, ${firstName}` : greeting}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {longDate.format(now)} · {ctx.institution.name}
          </p>
        </header>
        {tiles.length > 0 && (
          <KpiStrip className={tiles.length > 6 ? "xl:[&>div]:grid-cols-5" : undefined}>
            {tiles.map((t) => (
              <KpiTile key={t.label} {...t} />
            ))}
          </KpiStrip>
        )}
        {(canAttendance || approvalsPanel || staffPanel) && (
          <div className="grid gap-4 lg:grid-cols-3">
            {canAttendance && <div className="min-w-0 lg:col-span-2">{trendPanel}</div>}
            {(approvalsPanel || staffPanel) && (
              <div className={cn("min-w-0 space-y-4", canAttendance ? "lg:col-span-1" : "lg:col-span-3")}>
                {approvalsPanel}
                {staffPanel}
              </div>
            )}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            isAdminRole && quickPanel,
            sectionPanel,
            activityPanel,
            upcomingPanel,
            !isAdminRole && absenteesPanel,
            !isAdminRole && canResults && isModuleEnabled(ctx, "exams") && grades(""),
            askPanel,
          ].map((node, i) => node && <div key={i} className="min-w-0">{node}</div>)}
          {!isAdminRole && briefing && <div className="min-w-0 md:col-span-2 xl:col-span-3">{briefing}</div>}
        </div>
        {cards.length > 0 && (
          <section aria-labelledby="more-h" className="space-y-3 pt-2">
            <h2 id="more-h" className="text-base font-semibold">
              More from your school
            </h2>
            <CommandGrid layoutKey="command-more" defaultOrder={cards.map((c) => c.id)} cards={cards} />
          </section>
        )}
      </div>
    );
  }

  return (
    <div>
      {showHeader && (
        <PageHeader
          compact
          title={firstName ? `${greeting}, ${firstName}` : greeting}
          description={`${longDate.format(now)} · ${ctx.institution.name}`}
        />
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12">{body}</div>
    </div>
  );
}
