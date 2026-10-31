import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Banknote, CalendarCheck, CheckCircle2, GraduationCap, UserPlus } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/motion";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { AIInsightCard } from "@/components/widgets/ai-insight-card";
import { ApprovalsWidget } from "@/components/widgets/approvals-widget";
import { KpiTile } from "@/components/widgets/kpi-widget";
import { ListWidget, type ListRow } from "@/components/widgets/list-widget";
import { QuickActions, type QuickAction } from "@/components/widgets/quick-actions";
import { StaffAvailabilityWidget } from "@/components/widgets/staff-availability-widget";
import { TrendWidget } from "@/components/widgets/trend-widget";
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
import { RecentActivity } from "@/modules/core/components/dashboard/RecentActivity";
import { formatINR, getDashboardData } from "@/modules/core/dashboard.queries";
import { demoApprovals, demoAttendanceTrend, demoFixturesEnabled, demoInsights, demoStaffAvailability, type InsightRole } from "@/modules/core/demo/fixtures";
import { listExams, listRecheckQueue } from "@/modules/exams/queries";
import { examStatusVariant, recheckStatusVariant } from "@/modules/exams/status";
import { listDefaulters } from "@/modules/finance/queries";
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

/** The page's signature: what a school leader should act on first, as links. */
function NeedsAttention({ items }: { items: Attention[] }) {
  return (
    <section aria-labelledby="needs-attention" className={cn(FULL, "rounded-xl border bg-card px-4 py-3")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <h2 id="needs-attention" className="shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Needs attention
        </h2>
        {items.length === 0 ? (
          <p className="inline-flex min-h-10 items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden />
            All clear. Nothing is waiting on you right now.
          </p>
        ) : (
          <Stagger className="flex flex-wrap gap-2">
            {items.map((i) => (
              <StaggerItem key={i.key}>
                <Link
                  href={i.href}
                  className={cn(
                    "group/att inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm outline-none transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-out) focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
                    i.tone === "warning" && "border-warning/30 bg-warning/10 hover:bg-warning/15",
                    i.tone === "destructive" && "border-destructive/30 bg-destructive/10 hover:bg-destructive/15",
                    i.tone === "muted" && "bg-muted/50 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {i.tone !== "muted" && (
                    <span className={cn("font-semibold tabular-nums", i.tone === "warning" ? "text-warning" : "text-destructive")}>{i.count}</span>
                  )}
                  {i.label}
                  <ArrowRight className="size-3.5 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-out) group-hover/att:translate-x-0.5" aria-hidden />
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>
    </section>
  );
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
    <Stagger className={cn(FULL, "grid gap-4 sm:grid-cols-2 lg:grid-cols-4")}>
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

  const attendanceKpi = canAttendance && (
    <KpiTile
      label="Attendance today"
      value={`${data.attendanceToday.percentage}%`}
      animateTo={data.attendanceToday.percentage}
      format="percent"
      sub={`${data.attendanceToday.totalInDenominator} students marked`}
      href={`${basePath}/attendance`}
    />
  );
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

  const attendanceTrend =
    canAttendance &&
    (demo ? (
      <TrendWidget
        title="Attendance, last 4 weeks"
        description="School-wide daily attendance"
        data={demoAttendanceTrend({ key: demoKey, days: 28, endDate: now })}
        unit="percent"
        target={90}
        className={WIDE}
      />
    ) : (
      <Widget title="Present vs absent today" action={{ href: `${basePath}/attendance`, label: "Attendance" }} className={WIDE}>
        <AttendanceChart presentWeighted={data.attendanceToday.presentWeighted} totalInDenominator={data.attendanceToday.totalInDenominator} />
      </Widget>
    ));
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
            <KpiTile label="Outstanding" value={formatINR(outstandingPaise)} animateTo={outstandingPaise / 100} format="inr" sub={`of ${formatINR(collections.duePaise)} due this term`} href={`${basePath}/finance/defaulters`} />,
            <KpiTile
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

    body = (
      <>
        <NeedsAttention items={attention} />
        <Kpis
          items={[
            attendanceKpi,
            enquiryKpi,
            collectedKpi,
            canResults && (
              <KpiTile
                label="Published results"
                value={String(gd?.total ?? 0)}
                animateTo={gd?.total ?? 0}
                sub={gd ? gd.examName : "No published exam yet"}
                href={`${basePath}/exams`}
              />
            ),
          ]}
        />
        {attendanceTrend}
        {atRisk}
        {funnel(WIDE)}
        {collectionsChart(NARROW)}
        {insights && <Insights items={insights} className={WIDE} />}
        <div className={cn("min-w-0 space-y-4", insights ? NARROW : FULL)}>
          {briefing}
          {actions()}
        </div>
        {grades(NARROW)}
        {data.recentActivity && (
          <div className={cn("min-w-0", WIDE)}>
            <RecentActivity entries={data.recentActivity} />
          </div>
        )}
        {demo && (
          <>
            <StaffAvailabilityWidget title="Staff today" {...demoStaffAvailability(demoKey)} className={NARROW} />
            <ApprovalsWidget title="Pending approvals" rows={demoApprovals(demoKey, now)} className={WIDE} />
          </>
        )}
        {website}
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title={firstName ? `${greeting}, ${firstName}` : greeting}
        description={`${longDate.format(now)} · ${ctx.institution.name}`}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12">{body}</div>
    </div>
  );
}
