import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { Banknote, CalendarCheck, ChevronRight, GraduationCap, Sparkles, UserPlus } from "lucide-react";
import { GsapStage } from "@/components/gsap-stage";
import { SimulatedBadge } from "@/components/honesty";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AIInsightCard } from "@/components/widgets/ai-insight-card";
import { KpiStrip, KpiTile } from "@/components/widgets/kpi-widget";
import { ListWidget, type ListRow } from "@/components/widgets/list-widget";
import type { QuickAction } from "@/components/widgets/quick-actions";
import { StaffAvailabilityWidget } from "@/components/widgets/staff-availability-widget";
import { AnimatedList, BarList, BorderBeam, InteractiveTrend, ProgressBar, RadialGauge } from "@/components/widgets/viz";
import { Widget } from "@/components/widgets/widget";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { humanize, inr, type BadgeVariant } from "@/lib/format";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listEnquiriesByStage } from "@/modules/admissions/queries";
import { attendanceTrend, getAttendanceSettings } from "@/modules/attendance/queries";
import { repeatedAbsentees, sectionAttendanceToday } from "@/modules/attendance/command.queries";
import { calendarForRole } from "@/modules/calendar/queries";
import { pendingApprovals } from "@/modules/core/approvals.queries";
import { buildApprovalQueue } from "@/modules/core/approval-queue";
import { ApprovalsQueue } from "@/modules/core/components/dashboard/ApprovalsQueue";
import { CollectionsChart } from "@/modules/core/components/dashboard/CollectionsChart";
import { Panel, PanelEmpty, type FeedItem, type StatTileProps } from "@/modules/core/components/dashboard/command-center";
import { CustomiseDashboard } from "@/modules/core/components/dashboard/CustomiseDashboard";
import { DailyBriefing } from "@/modules/core/components/dashboard/DailyBriefing";
import { FeesByClassChart } from "@/modules/core/components/dashboard/FeesByClassChart";
import { GradeDistributionChart } from "@/modules/core/components/dashboard/GradeDistributionChart";
import { SetupChecklist } from "@/modules/core/setup/components/SetupChecklist";
import { getSetupStatus } from "@/modules/core/setup/queries";
import { getDashboardLayout } from "@/modules/core/dashboard-layout.queries";
import { applyLayout, DASHBOARD_WIDGETS, type DashboardWidgetId } from "@/modules/core/dashboard-widgets";
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
import { collectionReport, listDefaulters } from "@/modules/finance/queries";
import { assistantPromptsFor } from "@/modules/ai/prompts/dashboard-prompts";
import { staffAvailabilityToday } from "@/modules/people/hr.queries";
import { peopleCounts } from "@/modules/people/counts.queries";
import { studentLeaveRequests } from "@/modules/student-leave/queries";
import { listPublicEvents, listPublicNotices } from "@/modules/website/queries";
import { cn } from "cn";

export const metadata: Metadata = { title: "Dashboard" };

const TZ = "Asia/Kolkata";
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" });
const longDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const eventDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// 12-col desktop grid, 2-col tablet, 1-col phone, one gap (gap-4) everywhere.
// Rows pair 8/4, 7/5 or 6/6, or run three 4-col cards.
const MAIN = "md:col-span-2 lg:col-span-8";
const SIDE = "md:col-span-2 lg:col-span-4";
const WIDE = "md:col-span-2 lg:col-span-7";
const NARROW = "md:col-span-2 lg:col-span-5";
const HALF = "lg:col-span-6";
const THIRD = "lg:col-span-4";
const FULL = "md:col-span-2 lg:col-span-12";
const DAY_MS = 86_400_000;

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  principal: "Principal",
  admin: "Administrator",
  admissions: "Admissions",
  accountant: "Accounts",
  exam_controller: "Examinations",
};

/** One grid cell; GsapStage lifts it in on first view. */
function Cell({ span, children }: { span: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div data-gsap="rise" className={cn("min-w-0 [&>*]:h-full", span)}>
      {children}
    </div>
  );
}

function Hero({ title, subtitle, eyebrow, actions, customise }: { title: string; subtitle: string; eyebrow: string; actions: QuickAction[]; customise?: ReactNode }) {
  return (
    <header data-gsap="hero" className={cn(FULL, "relative overflow-hidden rounded-xl border bg-card px-5 py-5 sm:px-6 sm:py-6")}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_140%_at_100%_0%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_70%)]"
      />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-primary uppercase">{eyebrow}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {(actions.length > 0 || customise) && (
          <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button key={a.href + a.label} asChild variant="outline" size="sm" className="min-h-10 bg-background/70 backdrop-blur-sm">
                <Link href={a.href}>
                  {a.icon}
                  {a.label}
                </Link>
              </Button>
            ))}
            {customise}
          </nav>
        )}
      </div>
    </header>
  );
}

/** "just now" / "5m ago" / "3h ago", else the short date. */
function ago(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  return shortDate.format(new Date(iso));
}

const value = <T,>(r: PromiseSettledResult<T | null>): T | null => (r.status === "fulfilled" ? r.value : null);
const failed = (r: PromiseSettledResult<unknown>): boolean => r.status === "rejected";

type LiveItem = FeedItem & { badge?: { label: string; variant: BadgeVariant } };

/** Feed rows (same anatomy as command-center `Feed`) in an AnimatedList: first paint staggers, later rows slide in. */
function LiveFeed({ items, label }: { items: LiveItem[]; label: string }) {
  return (
    <AnimatedList ariaLabel={label} className="space-y-0 divide-y">
      {items.map((i) => {
        const body = (
          <div className="flex min-h-11 items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{i.title}</p>
              {i.meta && <p className="truncate text-xs text-muted-foreground">{i.meta}</p>}
            </div>
            {i.badge && <Badge variant={i.badge.variant}>{i.badge.label}</Badge>}
            {i.time && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{i.time}</span>}
          </div>
        );
        return i.href ? (
          <Link key={i.id} href={i.href} className="block rounded-sm outline-none transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
            {body}
          </Link>
        ) : (
          <div key={i.id}>{body}</div>
        );
      })}
    </AnimatedList>
  );
}

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
          {items.map((i, idx) => (
            <AIInsightCard key={`${i.title}:${idx}`} {...i} />
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
  const [defaultersR, feesByClassR] = await Promise.allSettled([
    (isLeader || role === "accountant") && termId ? listDefaulters(ctx, { termId }) : skip,
    (isLeader || role === "accountant") && termId ? collectionReport(ctx, { termId, groupBy: "grade" }) : skip,
  ]);
  const [noticesR, eventsR, rechecksR, examsR, enquiriesR, trendR, approvalsR, staffR, sectionAttR, countsR, sectionCountR, studentLeaveR, upcomingExamsR, calendarR, absenteesR] = await extrasP;
  for (const r of [noticesR, eventsR, rechecksR, examsR, enquiriesR, trendR, approvalsR, staffR, sectionAttR, countsR, sectionCountR, studentLeaveR, upcomingExamsR, calendarR, absenteesR, defaultersR, feesByClassR]) {
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
  const heroTitle = firstName ? `${greeting}, ${firstName}` : greeting;
  const hero = (customise?: ReactNode) => <Hero title={heroTitle} subtitle={`${longDate.format(now)} · ${ctx.institution.name}`} eyebrow={ROLE_LABEL[role] ?? humanize(role)} actions={quickActions} customise={customise} />;

  // Fees by class (grade) this term — finance.collectionReport, rupees.
  const feesByClass = value(feesByClassR);
  const feesByClassPanel = (className: string) =>
    failed(feesByClassR) ? (
      <FailedWidget title="Fees by class" className={className} />
    ) : (
      feesByClass && (
        <Cell span={className}>
          <Widget title="Fees by class" description="Collected and outstanding this term" action={{ href: `${basePath}/finance/invoices`, label: "Invoices" }}>
            <FeesByClassChart
              rows={feesByClass.map((r) => ({ label: r.groupLabel, collected: r.collected, outstanding: Math.max(r.outstanding ?? 0, 0) }))}
            />
          </Widget>
        </Cell>
      )
    );

  // Defaulter ageing: outstanding rupees by days past due (derived from the defaulter rows above).
  const ageing = (() => {
    if (!defaulters) return null;
    const buckets = [
      { label: "Not yet due", value: 0, tone: "default" as const },
      { label: "1–30 days late", value: 0, tone: "warning" as const },
      { label: "31–60 days late", value: 0, tone: "warning" as const },
      { label: "61–90 days late", value: 0, tone: "destructive" as const },
      { label: "Over 90 days late", value: 0, tone: "destructive" as const },
    ];
    const today = Date.parse(todayIso);
    for (const d of defaulters) {
      const late = d.dueOn ? Math.floor((today - Date.parse(d.dueOn)) / DAY_MS) : 0;
      const i = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
      buckets[i]!.value += d.outstanding;
    }
    return buckets;
  })();
  const ageingPanel = (className: string) =>
    defaultersFailed ? (
      <FailedWidget title="Outstanding by age" className={className} />
    ) : (
      ageing && (
        <Cell span={className}>
          <Widget
            title="Outstanding by age"
            description="Unpaid balance by days past due"
            action={{ href: `${basePath}/finance/defaulters`, label: "Defaulters" }}
            isEmpty={ageing.every((b) => b.value === 0)}
            empty={<EmptyState bare title="Nothing outstanding this term" />}
          >
            <BarList ariaLabel="Outstanding by days past due" format="inr" items={ageing.map((b) => ({ ...b, href: `${basePath}/finance/defaulters` }))} />
          </Widget>
        </Cell>
      )
    );

  // "Ask the data": role prompts pre-fill /assistant?q= (the user still presses Send).
  const askPanel = (className: string) =>
    isModuleEnabled(ctx, "ai_teacher") && (
      <Cell span={className}>
        <Panel title="Ask the data" action={{ href: `${basePath}/assistant`, label: "Open assistant" }} className="relative overflow-hidden">
          <BorderBeam />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" aria-hidden />
            Tap a question to open it in the assistant
          </p>
          <ul className="-mx-2">
            {assistantPromptsFor(role).map((prompt) => (
              <li key={prompt}>
                <Link
                  href={`${basePath}/assistant?q=${encodeURIComponent(prompt)}`}
                  className="group flex min-h-11 items-center justify-between gap-2 rounded-md px-2 text-sm transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">{prompt}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </Cell>
    );

  const enquiryKpi = canEnquiries && isModuleEnabled(ctx, "admissions") && (
    <KpiTile key="open-enquiries" label="Open enquiries" value={String(openEnquiries)} animateTo={openEnquiries} sub={`${enrolledCount} enrolled this year`} href={`${basePath}/admissions`} />
  );
  const collectedKpi = collections && (
    <KpiTile
      key="collected"
      label="Collected this term"
      value={formatINR(collections.collectedPaise)}
      animateTo={collections.collectedPaise / 100}
      format="inr"
      sub={`of ${formatINR(collections.duePaise)} due`}
      href={`${basePath}/finance`}
    />
  );

  const collectionsChart = (className: string, gauge = false) =>
    collections && (
      <Widget title="Fee collection this term" action={{ href: `${basePath}/finance`, label: "Finance" }} className={className}>
        {collectionPct !== null &&
          (gauge ? (
            <RadialGauge
              value={collectionPct}
              label="Collection rate"
              sublabel={`${formatINR(collections.collectedPaise)} of ${formatINR(collections.duePaise)}`}
              thresholds={{ good: 80, warn: 50 }}
              className="mb-4"
            />
          ) : (
            <ProgressBar label="Collected so far" value={collections.collectedPaise} max={collections.duePaise} valueLabel={`${collectionPct}%`} className="mb-4" />
          ))}
        <CollectionsChart collectedPaise={collections.collectedPaise} duePaise={collections.duePaise} />
      </Widget>
    );
  const funnel = (className: string) =>
    canEnquiries && isModuleEnabled(ctx, "admissions") && (
      <Widget title="Admissions funnel" action={{ href: `${basePath}/admissions`, label: "Pipeline" }} className={cn("md:col-span-2", className)}>
        {openEnquiries === 0 ? (
          <EmptyState bare title="No enquiries yet" />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            <BarList
              ariaLabel="Enquiries by stage"
              items={Object.entries(data.funnel.enquiryStages).map(([stage, n]) => ({ label: humanize(stage), value: n }))}
            />
            <BarList
              ariaLabel="Applications by status"
              items={Object.entries(data.funnel.applicationStatuses)
                .filter(([, n]) => n > 0)
                .map(([status, n]) => ({ label: humanize(status), value: n, tone: status === "enrolled" ? ("success" as const) : undefined }))}
            />
          </div>
        )}
      </Widget>
    );
  const gd = data.gradeDistribution;
  const grades = (className: string) =>
    canResults && isModuleEnabled(ctx, "exams") && (
      <Widget
        title="Exam grade distribution"
        description={gd ? `${gd.examName} — ${gd.total} results` : undefined}
        isEmpty={!gd}
        empty={<EmptyState bare title="No published exam yet" description="Grade distribution appears once results are published." />}
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
        <Widget
          title="Recheck requests"
          description={`${rechecks.length} waiting for review`}
          action={{ href: `${basePath}/exams/rechecks`, label: "Review all" }}
          isEmpty={rechecks.length === 0}
          empty={<EmptyState bare title="No recheck requests waiting" />}
          className={className}
        >
          <LiveFeed
            label="Recheck requests"
            items={rechecks.slice(0, 5).map((r) => ({
              id: r.id,
              title: r.studentName,
              meta: `${r.subjectName} · ${r.examName}`,
              href: `${basePath}/exams/rechecks/${r.id}`,
              badge: { label: humanize(r.status), variant: recheckStatusVariant(r.status) },
            }))}
          />
        </Widget>
      )
    );
  const canEditWebsite = hasPermission(ctx, "website.edit");
  const websiteEvents =
    showWebsite &&
    (failed(eventsR) ? (
        <FailedWidget title="Upcoming events" className={HALF} />
      ) : (
        <Cell span={HALF}>
        <ListWidget
          title="Upcoming events"
          action={canEditWebsite ? { href: `${basePath}/website/events`, label: "Events" } : undefined}
          emptyTitle="No upcoming public events"
          rows={(events ?? []).map((e) => ({ id: e.id, title: e.title, meta: [eventDate.format(new Date(e.startsAt)), e.location].filter(Boolean).join(" · ") }))}
        />
        </Cell>
      ));
  const websiteNotices =
    showWebsite &&
    (failed(noticesR) ? (
        <FailedWidget title="Latest notices" className={HALF} />
      ) : (
        <Cell span={HALF}>
        <ListWidget
          title="Latest notices"
          action={canEditWebsite ? { href: `${basePath}/website/notices`, label: "Notices" } : undefined}
          emptyTitle="No public notices"
          rows={(notices ?? []).map((n) => ({ id: n.id, title: n.title, meta: shortDate.format(new Date(n.publishAt)) }))}
        />
        </Cell>
      ));
  const defaultersFailed = failed(defaultersR);

  // ---- per-role layouts ----------------------------------------------------
  // Every role: hero, KPI strip, a main chart row, then cards. One grid,
  // one gap; GsapStage staggers the cells in.

  const kpiStrip = (items: ReactNode[]) => {
    const shown = items.filter(Boolean);
    if (shown.length === 0) return null;
    return (
      <div data-gsap="rise" className={FULL}>
        <KpiStrip className={cn("md:[&>div]:grid-cols-4", STRIP_COLS[Math.min(shown.length, 4)])}>{shown}</KpiStrip>
      </div>
    );
  };

  // Default-ordered [id, content] pairs; falsy content = not available to this user.
  const layout = await getDashboardLayout(ctx).catch(() => null);
  let widgets: [DashboardWidgetId, ReactNode][] = [];
  let fixedBody: ReactNode = null;
  if (role === "admissions") {
    const allEnquiries = Object.values(value(enquiriesR) ?? {}).flat();
    const enquiryRows: ListRow[] = [...allEnquiries]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6)
      .map((e) => ({
        id: e.id,
        title: e.childName,
        meta: `${e.guardianName} · ${shortDate.format(new Date(e.createdAt))}`,
        href: `${basePath}/admissions/enquiries/${e.id}`,
        badge: { label: humanize(e.status), variant: "outline" },
      }));
    // Weekly enquiry volume, last 8 weeks (oldest first), from the enquiry rows above.
    const weekStart = now.getTime() - 7 * 8 * DAY_MS;
    const weekly = Array.from({ length: 8 }, (_, i) => ({ label: shortDate.format(new Date(weekStart + i * 7 * DAY_MS)), value: 0 }));
    for (const e of allEnquiries) {
      const i = Math.floor((new Date(e.createdAt).getTime() - weekStart) / (7 * DAY_MS));
      if (i >= 0 && i < 8) weekly[i]!.value += 1;
    }
    const newThisWeek = weekly[7]?.value ?? 0;
    const bySource = Object.entries(
      allEnquiries.reduce<Record<string, number>>((acc, e) => ((acc[e.source] = (acc[e.source] ?? 0) + 1), acc), {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([source, n]) => ({ label: humanize(source), value: n }));
    const totalApps = Object.values(data.funnel.applicationStatuses).reduce((a, n) => a + n, 0);
    const conversion = totalApps > 0 ? Math.round((enrolledCount / totalApps) * 100) : null;
    const admissionsOn = canEnquiries && isModuleEnabled(ctx, "admissions");

    widgets = [
        ["kpi-strip", kpiStrip([
          enquiryKpi,
          admissionsOn && <KpiTile key="new" label="New this week" value={String(newThisWeek)} animateTo={newThisWeek} sub="enquiries received" href={`${basePath}/admissions`} />,
          admissionsOn && <KpiTile key="enrolled" label="Enrolled this year" value={String(enrolledCount)} animateTo={enrolledCount} href={`${basePath}/admissions/applications`} />,
          admissionsOn && (
            <KpiTile key="conv" label="Application conversion" value={conversion === null ? "—" : `${conversion}%`} animateTo={conversion ?? undefined} format="percent" sub={`${totalApps} applications`} />
          ),
        ])],
        ["enquiries-trend", admissionsOn && (
          <Cell span={MAIN}>
            <Widget title="Enquiries per week" description="Last 8 weeks" action={{ href: `${basePath}/admissions`, label: "Pipeline" }}>
              <InteractiveTrend title="Enquiries per week" unit="count" series={{ "8w": weekly }} keys={[{ key: "value", label: "Enquiries" }]} rangeLabels={{ "8w": "8 weeks" }} heightClass="h-56" />
            </Widget>
          </Cell>
        )],
        ["admissions-funnel", funnel("") && <Cell span={SIDE}>{funnel("")}</Cell>],
        ["enquiry-sources", admissionsOn && bySource.length > 0 && (
          <Cell span={THIRD}>
            <Widget title="Where enquiries come from">
              <BarList ariaLabel="Enquiries by source" items={bySource} />
            </Widget>
          </Cell>
        )],
        ["newest-enquiries", failed(enquiriesR) ? (
          <FailedWidget title="Newest enquiries" className={THIRD} />
        ) : (
          admissionsOn && (
            <Cell span={THIRD}>
              <ListWidget title="Newest enquiries" action={{ href: `${basePath}/admissions`, label: "All enquiries" }} emptyTitle="No enquiries yet" rows={enquiryRows} />
            </Cell>
          )
        )],
        ["ask-data", askPanel(THIRD)],
        ["insights", insights && <Cell span={briefing ? WIDE : FULL}><Insights items={insights} /></Cell>],
        ["ai-briefing", briefing && <Cell span={insights ? NARROW : FULL}>{briefing}</Cell>],
        ["website-events", websiteEvents],
        ["website-notices", websiteNotices],
    ];
  } else if (role === "accountant") {
    const topDefaulters = [...(defaulters ?? [])].sort((a, b) => b.outstanding - a.outstanding).slice(0, 6);
    if (collections) widgets = [
        ["kpi-strip", kpiStrip([
          collectedKpi,
          <KpiTile key="outstanding" label="Outstanding" value={formatINR(outstandingPaise)} animateTo={outstandingPaise / 100} format="inr" sub={`of ${formatINR(collections.duePaise)} due this term`} href={`${basePath}/finance/defaulters`} tone="warning" />,
          <KpiTile key="collection-rate" label="Collection rate" value={collectionPct === null ? "—" : `${collectionPct}%`} animateTo={collectionPct ?? undefined} format="percent" sub={`${collections.invoiceCount} invoices this term`} />,
          defaulters && (
            <KpiTile key="overdue" label="Overdue invoices" value={String(overdue.length)} animateTo={overdue.length} sub={`${defaulters.length} unpaid in total`} href={`${basePath}/finance/defaulters`} tone={overdue.length > 0 ? "destructive" : "default"} />
          ),
        ])],
        ["fees-by-class", feesByClassPanel(MAIN)],
        ["fee-collection", collectionsChart("", true) && <Cell span={SIDE}>{collectionsChart("", true)}</Cell>],
        ["outstanding-ageing", ageingPanel(NARROW)],
        ["top-defaulters", defaultersFailed ? (
          <FailedWidget title="Top defaulters" className={WIDE} />
        ) : (
          <Cell span={WIDE}>
            <ListWidget
              title="Top defaulters"
              description={`${defaulters?.length ?? 0} unpaid invoices, ${overdue.length} overdue`}
              action={{ href: `${basePath}/finance/defaulters`, label: "Remind in bulk" }}
              emptyTitle="No unpaid invoices this term"
              rows={topDefaulters.map((d) => ({
                id: d.invoiceId,
                title: d.studentName,
                meta: `${inr(d.outstanding)} outstanding · ${d.invoiceNo}${d.dueOn ? ` · due ${shortDate.format(new Date(d.dueOn))}` : ""}`,
                href: `${basePath}/finance/invoices/${d.invoiceId}`,
                badge: d.dueOn !== null && d.dueOn < todayIso ? { label: "Overdue", variant: "destructive" } : undefined,
              }))}
            />
          </Cell>
        )],
        ["ask-data", askPanel(insights ? NARROW : FULL)],
        ["insights", insights && <Cell span={WIDE}><Insights items={insights} /></Cell>],
    ];
    else fixedBody = data.collectionsFailed ? (
        <FailedWidget title="Fee collection this term" className={FULL} />
    ) : (
        <Cell span={FULL}>
          <Widget title="Fee collection this term">
            <EmptyState title="No current term" description="Collections appear once the current academic year has a term with invoices." />
          </Widget>
        </Cell>
    );
  } else if (role === "exam_controller") {
    const byStatus = (s: string) => exams?.filter((e) => e.status === s).length ?? 0;
    const examTotal = exams?.length ?? 0;
    widgets = [
        ["kpi-strip", kpiStrip([
          exams && <KpiTile key="me" label="In marks entry" value={String(byStatus("marks_entry"))} animateTo={byStatus("marks_entry")} sub={`${byStatus("draft")} in draft`} href={`${basePath}/exams`} />,
          exams && <KpiTile key="ver" label="In verification" value={String(byStatus("verification"))} animateTo={byStatus("verification")} href={`${basePath}/exams`} />,
          exams && <KpiTile key="pub" label="Published" value={String(byStatus("published"))} animateTo={byStatus("published")} sub={`of ${examTotal} exams`} href={`${basePath}/exams`} tone="success" />,
          rechecks && <KpiTile key="rc" label="Pending rechecks" value={String(rechecks.length)} animateTo={rechecks.length} href={`${basePath}/exams/rechecks`} tone={rechecks.length > 0 ? "warning" : "default"} />,
        ])],
        ["exam-grades", grades("") && <Cell span={MAIN}>{grades("")}</Cell>],
        ["exam-pipeline", exams && examTotal > 0 && (
          <Cell span={SIDE}>
            <Widget title="Exam pipeline" action={{ href: `${basePath}/exams`, label: "All exams" }}>
              <div className="space-y-4">
                <RadialGauge value={Math.round((byStatus("published") / examTotal) * 100)} label="Published" sublabel={`${byStatus("published")} of ${examTotal} exams`} thresholds={{ good: 60, warn: 30 }} />
                <BarList ariaLabel="Exams by status" items={(["draft", "marks_entry", "verification", "published"] as const).map((s) => ({ label: humanize(s), value: byStatus(s), href: `${basePath}/exams` }))} />
              </div>
            </Widget>
          </Cell>
        )],
        ["rechecks", recheckQueue("") && <Cell span={WIDE}>{recheckQueue("")}</Cell>],
        ["exams-list", failed(examsR) ? (
          <FailedWidget title="Exams" className={NARROW} />
        ) : (
          exams && (
            <Cell span={NARROW}>
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
              />
            </Cell>
          )
        )],
        ["ask-data", askPanel(insights ? NARROW : FULL)],
        ["insights", insights && <Cell span={WIDE}><Insights items={insights} /></Cell>],
    ];
  } else {
    // Leader command center (owner / principal / admin). Operational first:
    // KPI strip, attendance trend + gauges, fees by class, approvals, then
    // cards. Every figure comes from a query above; a missing
    // permission/module drops the tile.
    const isAdminRole = role === "admin";

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
    const marked = data.attendanceToday.studentsMarked;
    const inrWhole = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

    const tiles: (StatTileProps & { spark?: number[]; tone?: "default" | "success" | "warning" | "destructive" })[] = [];
    if (counts) {
      tiles.push({ label: "Students", value: counts.students.toLocaleString("en-IN"), href: `${basePath}/students` });
      tiles.push({ label: "Staff", value: counts.staff.toLocaleString("en-IN"), sub: sectionCount !== null ? `${sectionCount} sections` : undefined });
    }
    if (canAttendance) {
      tiles.push({
        label: "Attendance today",
        value: marked > 0 ? `${data.attendanceToday.percentage}%` : "—",
        sub: marked > 0 ? `${marked} marked${sectionAtt ? ` · ${sectionAtt.absentTotal} absent` : ""}` : "Not marked yet",
        href: `${basePath}/attendance`,
        spark: trendPts.length > 1 ? trendPts.map((p) => p.value) : undefined,
      });
    }
    if (queue) tiles.push({ label: "Approvals waiting", value: String(queue.total), sub: queue.total === 0 ? "Nothing to decide" : undefined, tone: queue.total > 0 ? "warning" : undefined });
    if (collections) tiles.push({ label: "Collected this term", value: inrWhole(collections.collectedPaise), sub: `of ${inrWhole(collections.duePaise)} due`, href: `${basePath}/finance` });
    if (defaulters) tiles.push({ label: "Overdue invoices", value: String(overdue.length), href: `${basePath}/finance/defaulters`, tone: overdue.length > 0 ? "destructive" : undefined });
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
            <BarList
              ariaLabel="Section attendance today, lowest first"
              max={100}
              items={sectionAtt.sections.slice(0, 7).map((s) => ({
                label: s.label,
                value: s.percentage,
                display: `${s.percentage}% · ${s.absent} absent`,
                tone: s.percentage < 75 ? ("destructive" as const) : undefined,
                href: `${basePath}/attendance/${s.classSectionId}`,
              }))}
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
            <LiveFeed label="Recent activity" items={data.recentActivity.slice(0, 6).map((e) => ({ id: e.id, title: e.renderedBody, meta: humanize(e.channel), time: ago(e.attemptedAt, now) }))} />
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
          <LiveFeed label="Upcoming events and exams" items={upcomingItems} />
        )}
      </Panel>
    );

    // Ranges are slices of the one 42-day series already loaded: last 10 school days, and all of it.
    const trendRows = trendPts.map((p) => ({ label: p.label, value: p.value }));
    const trendSeries: Record<string, typeof trendRows> = trendRows.length > 10 ? { "2w": trendRows.slice(-10), "6w": trendRows } : { "6w": trendRows };
    const trendPanel = (
      <Widget title="Attendance performance" description="School-wide attendance by school day">
        <InteractiveTrend
          title="Attendance performance"
          unit="percent"
          series={trendSeries}
          keys={[{ key: "value", label: "Attendance" }]}
          defaultRange="6w"
          rangeLabels={{ "2w": "2 weeks", "6w": "6 weeks" }}
          heightClass="h-56"
        />
      </Widget>
    );

    // Today at a glance: the two headline percentages as gauges (same figures as the KPI strip).
    const attThresholds = getAttendanceSettings(ctx).thresholds;
    const glance = [
      canAttendance && marked > 0 && (
        <RadialGauge key="att" value={data.attendanceToday.percentage} label="Present today" sublabel={`${marked} students marked`} thresholds={{ good: attThresholds.warn, warn: attThresholds.critical }} />
      ),
      collections && collectionPct !== null && (
        <RadialGauge key="fees" value={collectionPct} label="Term fees collected" sublabel={`${inrWhole(collections.collectedPaise)} of ${inrWhole(collections.duePaise)}`} thresholds={{ good: 80, warn: 50 }} />
      ),
    ].filter(Boolean);
    const glancePanel = glance.length > 0 && (
      <Panel title="Today at a glance">
        <div className="grid h-full content-center gap-6 py-2 sm:grid-cols-2 lg:grid-cols-1">{glance}</div>
      </Panel>
    );
    const staffToday = value(staffR);
    const staffPanel = failed(staffR) ? <FailedWidget title="Staff today" /> : staffToday && <StaffAvailabilityWidget title="Staff today" description="Self check-ins are self-reported" {...staffToday} />;

    const absenteesPanel = !isAdminRole && canAttendance && (
      failed(absenteesR) ? (
        <FailedWidget title="Repeated absentees" />
      ) : (
        <Panel title="Repeated absentees" count="last 14 days">
          {!absentees || absentees.length === 0 ? (
            <PanelEmpty title="No repeated absences" hint="Students absent 3 or more days in the last 14 appear here." />
          ) : (
            <LiveFeed label="Repeated absentees" items={absentees.map((s) => ({ id: s.studentId, title: s.name, meta: s.classSection, time: `${s.absences} days`, href: `${basePath}/students/${s.studentId}` }))} />
          )}
        </Panel>
      )
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

    const sideStack = (approvalsPanel || staffPanel) && (
      <div className="flex min-w-0 flex-col gap-4">
        {approvalsPanel}
        {staffPanel}
      </div>
    );

    widgets = [
        ["kpi-strip", tiles.length > 0 && (
          <div data-gsap="rise" className={FULL}>
            <KpiStrip className="md:[&>div]:grid-cols-4 xl:[&>div]:grid-cols-4">
              {tiles.slice(0, 8).map((t) => (
                <KpiTile key={t.label} {...t} />
              ))}
            </KpiStrip>
          </div>
        )],
        ["attendance-trend", canAttendance && <Cell span={MAIN}>{trendPanel}</Cell>],
        ["today-glance", glancePanel && <Cell span={canAttendance ? SIDE : FULL}>{glancePanel}</Cell>],
        ["fees-by-class", feesByClassPanel(sideStack ? MAIN : FULL)],
        ["approvals-staff", sideStack && <Cell span={feesByClass || failed(feesByClassR) ? SIDE : FULL}>{sideStack}</Cell>],
        ["section-attendance", sectionPanel && <Cell span={THIRD}>{sectionPanel}</Cell>],
        ["upcoming", upcomingPanel && <Cell span={THIRD}>{upcomingPanel}</Cell>],
        ["recent-activity", activityPanel && <Cell span={THIRD}>{activityPanel}</Cell>],
        ["repeated-absentees", !isAdminRole && absenteesPanel && <Cell span={THIRD}>{absenteesPanel}</Cell>],
        ["outstanding-ageing", ageingPanel(THIRD)],
        ["ask-data", askPanel(THIRD)],
        ["admissions-funnel", funnel("") && <Cell span={HALF}>{funnel("")}</Cell>],
        [isAdminRole ? "fee-collection" : "exam-grades", (isAdminRole ? collectionsChart("") : grades("")) && <Cell span={HALF}>{isAdminRole ? collectionsChart("") : grades("")}</Cell>],
        ["ai-briefing", !isAdminRole && briefing && <Cell span={FULL}>{briefing}</Cell>],
        ["more-cards", cards.length > 0 && (
          <section data-gsap="rise" aria-labelledby="more-h" className={cn(FULL, "space-y-3 pt-2")}>
            <h2 id="more-h" className="text-base font-semibold">
              More from your school
            </h2>
            <CommandGrid institutionSlug={institutionSlug} layout={layout} cards={cards} />
          </section>
        )],
    ];
  }

  // Per-user layout: hide/reorder only what this user is already offered above.
  const content = new Map(widgets.filter(([, node]) => node));
  const available: string[] = [...content.keys()];
  const shown = applyLayout(available, layout);
  const hiddenIds = new Set(available.filter((id) => !shown.includes(id)));
  const orderedAll = applyLayout(available, { hidden: [], order: layout?.order ?? [] });
  const body = (
    <>
      {hero(
        available.length > 0 && (
          <CustomiseDashboard
            institutionSlug={institutionSlug}
            widgets={orderedAll.map((id) => ({ id: id as DashboardWidgetId, label: DASHBOARD_WIDGETS[id as DashboardWidgetId], visible: !hiddenIds.has(id) }))}
            customised={layout !== null}
          />
        ),
      )}
      {fixedBody}
      {shown.map((id) => (
        <Fragment key={id}>{content.get(id as DashboardWidgetId)}</Fragment>
      ))}
    </>
  );

  // F18 §H: setup progress for school managers, until every step is done or skipped.
  const setupStatus = hasPermission(ctx, "institution.settings.manage") ? await getSetupStatus(ctx).catch(() => null) : null;

  return (
    <>
      {setupStatus && !setupStatus.complete && <SetupChecklist institutionSlug={institutionSlug} status={setupStatus} />}
      <GsapStage className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12">{body}</GsapStage>
    </>
  );
}
