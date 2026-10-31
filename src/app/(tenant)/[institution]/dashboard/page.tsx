import type { ReactNode } from "react";
import { AlertTriangle, Banknote, BarChart3, CalendarCheck, CheckCircle2, ClipboardList, GraduationCap, MessageSquare, Store, UserPlus, Users } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/motion";
import { SimulatedBadge } from "@/components/honesty";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { AIInsightCard } from "@/components/widgets/ai-insight-card";
import { ApprovalsWidget } from "@/components/widgets/approvals-widget";
import { HomeActivity, HomeHero, HomeKpi, HomePerformance, HomePromo, HomeQuickActions, HomeSchedule, type ActivityItem, type HeroChip, type HomeQuickAction, type ScheduleItem } from "@/components/widgets/home-blocks";
import { InsightCarousel, type CarouselInsight } from "@/components/widgets/insight-carousel";
import { KpiTile } from "@/components/widgets/kpi-widget";
import { ListWidget, type ListRow } from "@/components/widgets/list-widget";
import { QuickActions, type QuickAction } from "@/components/widgets/quick-actions";
import { StaffAvailabilityWidget } from "@/components/widgets/staff-availability-widget";
import { Widget } from "@/components/widgets/widget";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { humanize, inr } from "@/lib/format";
import { listEnquiriesByStage } from "@/modules/admissions/queries";
import { AttendanceChart } from "@/modules/core/components/dashboard/AttendanceChart";
import { CollectionsChart } from "@/modules/core/components/dashboard/CollectionsChart";
import { DailyBriefing } from "@/modules/core/components/dashboard/DailyBriefing";
import { FunnelChart } from "@/modules/core/components/dashboard/FunnelChart";
import { GradeDistributionChart } from "@/modules/core/components/dashboard/GradeDistributionChart";
import { formatINR, getDashboardData } from "@/modules/core/dashboard.queries";
import { demoApprovals, demoAttendanceTrend, demoFixturesEnabled, demoInsights, demoStaffAvailability, type InsightRole } from "@/modules/core/demo/fixtures";
import { listExams, listRecheckQueue } from "@/modules/exams/queries";
import { CommandGrid, type GridCard } from "@/modules/fabric/components/command/command-grid";
import { DailyBriefWidget } from "@/modules/fabric/components/command/daily-brief";
import { ForecastCards } from "@/modules/fabric/components/command/forecast-cards";
import { PriorityActionsWidget } from "@/modules/fabric/components/command/priority-actions";
import { RiskIndicators } from "@/modules/fabric/components/command/risk-indicators";
import { SEVERITY } from "@/modules/fabric/components/command/severity";
import { startOfToday } from "@/modules/fabric/components/fabric-page";
import { dailyBrief, forecastCards, priorityActions, riskIndicators } from "@/modules/fabric/demo/command";
import { insights as fabricInsights } from "@/modules/fabric/demo/insights";
import { examStatusVariant, recheckStatusVariant } from "@/modules/exams/status";
import { listDefaulters } from "@/modules/finance/queries";
import { listPublicEvents, listPublicNotices } from "@/modules/website/queries";
import { cn } from "cn";

const TZ = "Asia/Kolkata";
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" });
const longDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const dayLabel = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "short" });
const eventDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// 12-col desktop grid, 2-col tablet, 1-col phone. Pairs are 7/5 or 6/6.
const WIDE = "lg:col-span-7";
const NARROW = "lg:col-span-5";
const HALF = "lg:col-span-6";
const FULL = "md:col-span-2 lg:col-span-12";

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

function FailedWidget({ title, className }: { title: string; className?: string }) {
  return (
    <Widget title={title} className={className}>
      <ErrorState title={`Couldn't load ${title.toLowerCase()}`} description="The rest of the dashboard is unaffected. Refresh to try again." />
    </Widget>
  );
}

interface Attention {
  key: string;
  count: number;
  label: string;
  href: string;
  tone: "warning" | "destructive" | "muted";
}

function Insights({ items, className }: { items: ReturnType<typeof demoInsights>; className?: string }) {
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

function Kpis({ items }: { items: ReactNode[] }) {
  return (
    <Stagger className={cn(FULL, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}>
      {items.filter(Boolean).map((c, i) => (
        <StaggerItem key={i} className="min-w-0">
          {c}
        </StaggerItem>
      ))}
    </Stagger>
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
    showWebsite ? listPublicNotices(ctx.institution.id, 4) : skip,
    // shortcut: listPublicEvents has no date filter, so take 20 and keep upcoming; upgrade if a school has >20 past public events.
    showWebsite ? listPublicEvents(ctx.institution.id, 20) : skip,
    (isLeader || role === "exam_controller") && canRechecks ? listRecheckQueue(ctx, "submitted") : skip,
    role === "exam_controller" && canResults ? listExams(ctx) : skip,
    role === "admissions" && canEnquiries ? listEnquiriesByStage(ctx) : skip,
  ]);
  const data = await getDashboardData(ctx);
  const termId = data.collections?.termId;
  const [defaultersR] = await Promise.allSettled([(isLeader || role === "accountant") && termId ? listDefaulters(ctx, { termId }) : skip]);
  const [noticesR, eventsR, rechecksR, examsR, enquiriesR] = await extrasP;
  for (const r of [noticesR, eventsR, rechecksR, examsR, enquiriesR, defaultersR]) {
    if (r.status === "rejected") console.error("dashboard widget fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  }

  const now = new Date();
  const basePath = `/${institutionSlug}`;
  const todayIso = now.toLocaleDateString("en-CA", { timeZone: TZ });
  const demo = demoFixturesEnabled(ctx);
  const demoKey = ctx.institution.id;

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

  const insightRole: InsightRole = isLeader ? "principal" : role === "admissions" || role === "accountant" ? role : "exam_controller";
  const insights = demo
    ? demoInsights(insightRole, {
        attendancePct: canAttendance ? data.attendanceToday.percentage : undefined,
        lowAttendanceSections: canAttendance ? data.sectionsAtRisk.length : undefined,
        openEnquiries: canEnquiries ? openEnquiries : undefined,
        outstandingFees: collections ? outstandingPaise / 100 : undefined,
        overdueInvoices: defaulters ? overdue.length : undefined,
        basePath,
      })
    : null;

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

  const enquiryKpi = canEnquiries && (
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

  const atRisk = canAttendance && (
    <ListWidget
      title="Sections below threshold today"
      emptyTitle="All sections above threshold"
      rows={data.sectionsAtRisk.map((s) => ({
        id: s.classSectionId,
        title: s.label,
        href: `${basePath}/attendance/${s.classSectionId}`,
        badge: { label: `${s.percentage}%`, variant: "warning" },
      }))}
      className={NARROW}
    />
  );
  const collectionsChart = (className: string) =>
    collections && (
      <Widget title="Fee collection this term" action={{ href: `${basePath}/finance`, label: "Finance" }} className={className}>
        <CollectionsChart collectedPaise={collections.collectedPaise} duePaise={collections.duePaise} />
      </Widget>
    );
  const funnel = (className: string) =>
    canEnquiries && (
      <Widget title="Admissions funnel" action={{ href: `${basePath}/admissions`, label: "Pipeline" }} className={cn("md:col-span-2", className)}>
        <FunnelChart funnel={data.funnel} />
      </Widget>
    );
  const gd = data.gradeDistribution;
  const grades = (className: string) =>
    canResults && (
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
            canEnquiries && <KpiTile label="Enrolled this year" value={String(enrolledCount)} animateTo={enrolledCount} href={`${basePath}/admissions/applications`} />,
            quickActions.length > 0 && actions("h-full"),
          ]}
        />
        {funnel(WIDE)}
        {failed(enquiriesR) ? (
          <FailedWidget title="Newest enquiries" className={NARROW} />
        ) : (
          canEnquiries && (
            <ListWidget
              title="Newest enquiries"
              action={{ href: `${basePath}/admissions`, label: "All enquiries" }}
              emptyTitle="No enquiries yet"
              rows={enquiryRows}
              className={NARROW}
            />
          )
        )}
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
            quickActions.length > 0 && actions("h-full"),
          ]}
        />
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
    const attention: Attention[] = [];
    if (canAttendance && data.sectionsAtRisk.length > 0) {
      const n = data.sectionsAtRisk.length;
      attention.push({ key: "att", count: n, label: `${n === 1 ? "section" : "sections"} below attendance threshold`, href: `${basePath}/attendance`, tone: "warning" });
    }
    if (defaultersFailed) attention.push({ key: "fees", count: 0, label: "Overdue invoices unavailable", href: `${basePath}/finance/defaulters`, tone: "muted" });
    else if (overdue.length > 0) attention.push({ key: "fees", count: overdue.length, label: `overdue ${overdue.length === 1 ? "invoice" : "invoices"}`, href: `${basePath}/finance/defaulters`, tone: "destructive" });
    if (failed(rechecksR)) attention.push({ key: "rc", count: 0, label: "Recheck requests unavailable", href: `${basePath}/exams/rechecks`, tone: "muted" });
    else if (rechecks && rechecks.length > 0) attention.push({ key: "rc", count: rechecks.length, label: `recheck ${rechecks.length === 1 ? "request" : "requests"} waiting`, href: `${basePath}/exams/rechecks`, tone: "warning" });

    // Fabric widgets run on deterministic demo fixtures, so they only exist for the demo tenant.
    const fOpts = { now: startOfToday(), institutionId: ctx.institution.id };
    showHeader = false;

    const trend = (key: string, base: number) => (demo ? demoAttendanceTrend({ key: `${demoKey}:${key}`, days: 24, endDate: now, base }).map((p) => p.value) : undefined);
    const deltaOf = (s?: number[]) => (s && s.length > 1 ? ((s[s.length - 1] - s[0]) / s[0]) * 100 : undefined);
    const sparkAtt = trend("att", 93);
    const sparkEnq = trend("enq", 91);
    const sparkFee = trend("fee", 92);
    const sparkRes = trend("res", 94);

    const chips: HeroChip[] = [];
    if (canAttendance) chips.push({ key: "att", icon: <Users />, tone: "info", label: `Today's attendance: ${data.attendanceToday.percentage}%` });
    for (const a of attention) {
      chips.push({ key: a.key, href: a.href, icon: a.tone === "destructive" ? <AlertTriangle /> : <ClipboardList />, tone: a.tone === "destructive" ? "destructive" : "warning", label: a.count ? `${a.count} ${a.label}` : a.label });
    }
    if (attention.length === 0) chips.push({ key: "clear", icon: <CheckCircle2 />, tone: "success", label: "All clear — nothing is waiting on you" });

    const sentence = [
      canAttendance && `attendance is at ${data.attendanceToday.percentage}% today`,
      canEnquiries && `${openEnquiries} ${openEnquiries === 1 ? "enquiry is" : "enquiries are"} open`,
      collections && `${formatINR(outstandingPaise)} in fees is outstanding`,
    ].filter(Boolean) as string[];
    const description = sentence.length ? `Here is where ${ctx.institution.name} stands: ${sentence.join(", ")}.` : `Here is what is happening at ${ctx.institution.name} today.`;

    const homeKpis = [
      canAttendance && (
        <HomeKpi key="att" icon={<CalendarCheck />} tone="info" label="Attendance today" value={`${data.attendanceToday.percentage}%`} animateTo={data.attendanceToday.percentage} format="percent" delta={deltaOf(sparkAtt)} spark={sparkAtt} footLeft={`${data.attendanceToday.totalInDenominator} students marked`} footRight={data.sectionsAtRisk.length ? `${data.sectionsAtRisk.length} sections at risk` : "All sections on track"} href={`${basePath}/attendance`} />
      ),
      canEnquiries && (
        <HomeKpi key="enq" icon={<UserPlus />} tone="primary" label="Open enquiries" value={String(openEnquiries)} animateTo={openEnquiries} delta={deltaOf(sparkEnq)} spark={sparkEnq} footLeft={`${enrolledCount} enrolled this year`} footRight="Pipeline" href={`${basePath}/admissions`} />
      ),
      collections && (
        <HomeKpi key="fee" icon={<Banknote />} tone="success" label="Collected this term" value={formatINR(collections.collectedPaise)} animateTo={collections.collectedPaise / 100} format="inr" delta={deltaOf(sparkFee)} spark={sparkFee} footLeft={`of ${formatINR(collections.duePaise)} due`} footRight={collectionPct === null ? undefined : `${collectionPct}% collected`} href={`${basePath}/finance`} />
      ),
      canResults && (
        <HomeKpi key="res" icon={<GraduationCap />} tone="warning" label="Published results" value={String(gd?.total ?? 0)} animateTo={gd?.total ?? 0} delta={deltaOf(sparkRes)} spark={sparkRes} footLeft={gd ? gd.examName : "No published exam yet"} footRight="Exams" href={`${basePath}/exams`} />
      ),
    ].filter(Boolean);

    // Six weekly averages of the school-wide attendance trend; the last bar is "now".
    let bars: { label: string; value: number }[] | undefined;
    if (demo && canAttendance) {
      const pts = demoAttendanceTrend({ key: demoKey, days: 42, endDate: now });
      const size = Math.ceil(pts.length / 6);
      bars = Array.from({ length: 6 }, (_, i) => pts.slice(i * size, (i + 1) * size)).filter((c) => c.length).map((c) => ({ label: c[c.length - 1].label, value: Math.round((c.reduce((t, p) => t + p.value, 0) / c.length) * 10) / 10 }));
    }

    const activityItems: ActivityItem[] = (data.recentActivity ?? []).slice(0, 8).map((e) => ({
      id: e.id,
      icon: <MessageSquare />,
      tone: "primary",
      title: e.renderedBody,
      meta: humanize(e.channel),
      time: ago(e.attemptedAt, now),
    }));

    const tones = ["primary", "info", "success", "warning"] as const;
    const homeActions: HomeQuickAction[] = quickActions.map((a, i) => ({ href: a.href, label: a.label, icon: a.icon, tone: tones[i % tones.length] }));
    const scheduleItems: ScheduleItem[] = (events ?? []).map((e) => ({ id: e.id, time: shortDate.format(new Date(e.startsAt)), title: e.title, meta: [eventDate.format(new Date(e.startsAt)), e.location].filter(Boolean).join(" · ") }));

    const carousel: CarouselInsight[] = demo
      ? fabricInsights(fOpts).slice(0, 4).map((i) => ({ id: i.id, title: i.title, body: i.pattern, severityLabel: SEVERITY[i.severity].label, confidence: i.confidence, href: `${basePath}/fabric/insights?id=${i.id}` }))
      : [];

    // Everything below the hero/KPIs/split stays available as a customisable grid.
    const cards: GridCard[] = [];
    const add = (id: string, title: string, span: string, node: ReactNode) => node && cards.push({ id, title, span, node });
    if (demo) {
      add("brief", "Today's brief", WIDE, <DailyBriefWidget brief={dailyBrief(fOpts, "principal")} base={basePath} />);
      add("priorities", "Priorities", NARROW, <PriorityActionsWidget actions={priorityActions(fOpts).slice(0, 5)} base={basePath} />);
      add("forecasts", "Forecasts", FULL, <ForecastCards cards={forecastCards(fOpts)} base={basePath} />);
      add("risks", "Risks", NARROW, <RiskIndicators risks={riskIndicators(fOpts)} base={basePath} />);
    }
    add("atRisk", "Sections at risk", NARROW, atRisk);
    add("funnel", "Admissions funnel", WIDE, funnel(""));
    add("collections", "Fee collection", NARROW, collectionsChart(""));
    if (demo) {
      add("approvals", "Approvals", WIDE, <ApprovalsWidget title="Pending approvals" rows={demoApprovals(demoKey, now)} />);
      add("staff", "Staff today", NARROW, <StaffAvailabilityWidget title="Staff today" {...demoStaffAvailability(demoKey)} />);
    }
    add("grades", "Grades", NARROW, grades(""));
    add("assistant", "AI briefing", NARROW, briefing);
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
        <HomeHero eyebrow={dayLabel.format(now)} updated="Updated just now" title={firstName ? `${greeting}, ${firstName}` : greeting} description={description} chips={chips} />
        {homeKpis.length > 0 && (
          <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {homeKpis.map((k, i) => (
              <StaggerItem key={i} className="min-w-0">
                {k}
              </StaggerItem>
            ))}
          </Stagger>
        )}
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="min-w-0 space-y-4 lg:col-span-8">
            {canAttendance && (
              <HomePerformance title="Attendance performance" description="School-wide attendance, week by week" icon={<BarChart3 />} bars={bars} footer={bars ? "Weekly average of daily attendance" : undefined}>
                <AttendanceChart presentWeighted={data.attendanceToday.presentWeighted} totalInDenominator={data.attendanceToday.totalInDenominator} />
              </HomePerformance>
            )}
            <HomePromo icon={<Store />} tag="Add-ons" title="Explore the CoolSkool marketplace" body="Install modules for fee billing, timetable scheduling and parent messaging, and turn on only what your school needs." cta="Browse marketplace" href={`${basePath}/fabric/marketplace`} />
            <HomeActivity title="Recent activity" items={activityItems} badge={<SimulatedBadge />} action={ctx.permissions.has("notification.log.read") ? { href: `${basePath}/notifications/log`, label: "View message log" } : undefined} empty="No messages sent yet." />
          </div>
          <div className="min-w-0 space-y-4 lg:col-span-4">
            {carousel.length > 0 && <InsightCarousel items={carousel} allHref={`${basePath}/fabric/insights`} />}
            <HomeQuickActions actions={homeActions} />
            <HomeSchedule title="Upcoming events" count={`${scheduleItems.length} upcoming`} items={scheduleItems} action={canEditWebsite ? { href: `${basePath}/website/events`, label: "Manage" } : undefined} empty="No upcoming public events." />
          </div>
        </div>
        {cards.length > 0 && (
          <section aria-labelledby="more-h" className="space-y-3 pt-2">
            <h2 id="more-h" className="text-[17px] font-semibold tracking-[-0.01em]">
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
