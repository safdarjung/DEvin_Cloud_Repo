import Link from "next/link";
import type { ReactNode } from "react";
import { ClipboardCheck, ClipboardList, FilePlus2, Megaphone, PenLine } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/motion";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AIInsightCard } from "@/components/widgets/ai-insight-card";
import { KpiTile } from "@/components/widgets/kpi-widget";
import { ListWidget, type ListRow } from "@/components/widgets/list-widget";
import { QuickActions, type QuickAction } from "@/components/widgets/quick-actions";
import { TimetableWidget } from "@/components/widgets/timetable-widget";
import { Widget } from "@/components/widgets/widget";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listTeacherAssignments } from "@/modules/academics/assignments.queries";
import { assignmentStatusVariant } from "@/modules/academics/status";
import { getSession, getTodaySectionsForTeacher } from "@/modules/attendance/queries";
import { demoFixturesEnabled, demoInsights, demoTimetable } from "@/modules/core/demo/fixtures";
import { getMyPapers } from "@/modules/exams/queries";
import { examStatusVariant } from "@/modules/exams/status";
import { listMyNotifications } from "@/modules/notifications/queries";
import { listPublicEvents, listPublicNotices } from "@/modules/website/queries";

const TZ = "Asia/Kolkata";
const dayLabel = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const shortDate = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const istHour = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" });
// shortcut: register status is one getSession per section; non-teacher roles see every section, so cap the lookups.
const STATUS_LOOKUP_LIMIT = 8;

type RegisterStatus = "open" | "submitted" | null | undefined;

function greeting(now: Date, fullName: string | null): string {
  const hour = Number(istHour.format(now));
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}

function registerBadge(status: RegisterStatus) {
  if (status === "submitted") return <Badge variant="success">Submitted</Badge>;
  if (status === "open") return <Badge variant="warning">In progress</Badge>;
  if (status === null) return <Badge variant="outline">Not marked</Badge>;
  return null;
}

/** A rejected widget query renders an ErrorState in that widget only. */
function settled<T>(r: PromiseSettledResult<T>, render: (value: T) => ReactNode, title: string): ReactNode {
  return r.status === "fulfilled" ? render(r.value) : <Widget title={title}><ErrorState description={`We couldn't load ${title.toLowerCase()}.`} /></Widget>;
}

export default async function TodayPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "attendance.mark");

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
  const basePath = `/${institutionSlug}`;
  const canEnterMarks = hasPermission(ctx, "exam.marks.enter");
  const canReadAssignments = hasPermission(ctx, "assignment.read");
  const canManageAssignments = hasPermission(ctx, "assignment.manage");
  const canReadNotifications = hasPermission(ctx, "notification.read");

  const [sectionsR, papersR, assignmentsR, notificationsR, noticesR, eventsR] = await Promise.allSettled([
    isModuleEnabled(ctx, "attendance") ? getTodaySectionsForTeacher(ctx).then((sections) =>
      Promise.all(
        sections.map(async (s, i) => ({
          ...s,
          status: (i < STATUS_LOOKUP_LIMIT
            ? ((await getSession(ctx, s.id, today))?.session?.status ?? null)
            : undefined) as RegisterStatus,
        })),
      ),
    ) : Promise.resolve([]),
    canEnterMarks && isModuleEnabled(ctx, "exams") ? getMyPapers(ctx) : Promise.resolve([]),
    canReadAssignments && isModuleEnabled(ctx, "assignments") ? listTeacherAssignments(ctx) : Promise.resolve([]),
    canReadNotifications && isModuleEnabled(ctx, "notifications") ? listMyNotifications(ctx, 5) : Promise.resolve([]),
    isModuleEnabled(ctx, "website") ? listPublicNotices(ctx.institution.id, 3) : Promise.resolve([]),
    // Ordered oldest-first with no date filter, so over-fetch and keep the upcoming ones.
    isModuleEnabled(ctx, "website") ? listPublicEvents(ctx.institution.id, 20).then((events) => events.filter((e) => new Date(e.endsAt ?? e.startsAt) >= now).slice(0, 3)) : Promise.resolve([]),
  ]);

  const sections = sectionsR.status === "fulfilled" ? sectionsR.value : [];
  const papers = papersR.status === "fulfilled" ? papersR.value : [];
  const activeAssignments = assignmentsR.status === "fulfilled" ? assignmentsR.value.filter((a) => a.status !== "closed") : [];
  const pending = sections.filter((s) => s.status !== "submitted");
  const registerHref = (sectionId: string) => `${basePath}/attendance/${sectionId}?date=${today}`;

  const demo = demoFixturesEnabled(ctx);
  const timetable = demo
    ? demoTimetable({
        day: now,
        entries: papers.length
          ? [...new Map(papers.map((p) => [`${p.sectionLabel}:${p.subjectName}`, { title: p.subjectName, subtitle: p.sectionLabel }])).values()]
          : sections.map((s) => ({ title: s.label })),
      })
    : null;
  const insights = demo ? demoInsights("teacher", { pendingMarks: papers.length, basePath }) : [];

  const quickActions: QuickAction[] = [
    ...(canManageAssignments ? [{ href: `${basePath}/assignments/new`, label: "New assignment", icon: <FilePlus2 className="size-4" /> }] : []),
    ...(canReadAssignments ? [{ href: `${basePath}/assignments`, label: "All assignments", icon: <ClipboardList className="size-4" /> }] : []),
    ...(canEnterMarks ? [{ href: `${basePath}/exams`, label: "Exams", icon: <PenLine className="size-4" /> }] : []),
  ];

  const kpis = [
    { label: "Sections today", n: sectionsR.status === "fulfilled" ? sections.length : undefined, href: `${basePath}/attendance` },
    { label: "Registers pending", n: sectionsR.status === "fulfilled" ? pending.length : undefined, href: `${basePath}/attendance` },
    canEnterMarks && { label: "Marks to enter", n: papersR.status === "fulfilled" ? papers.length : undefined, href: `${basePath}/exams` },
    canReadAssignments && {
      label: "Active assignments",
      n: assignmentsR.status === "fulfilled" ? activeAssignments.length : undefined,
      href: `${basePath}/assignments`,
    },
  ].filter((k) => !!k);

  const sectionsWidget = settled(
    sectionsR,
    (rows) => (
      <Widget
        title="Today's registers"
        description={rows.length ? `${pending.length} of ${rows.length} still to submit` : undefined}
        icon={<ClipboardCheck />}
        isEmpty={rows.length === 0}
        empty={<EmptyState title="No sections to mark today" />}
      >
        <ul className="divide-y">
          {rows.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{s.label}</span>
                {registerBadge(s.status)}
              </div>
              <Button asChild variant={s.status === "submitted" ? "outline" : "default"} className="shrink-0 sm:h-10 sm:px-4">
                <Link href={registerHref(s.id)}>Open register</Link>
              </Button>
            </li>
          ))}
        </ul>
      </Widget>
    ),
    "Today's registers",
  );

  const papersWidget =
    canEnterMarks &&
    settled(
      papersR,
      (rows) => (
        <ListWidget
          title="Marks to enter"
          icon={<PenLine />}
          emptyTitle="No marks sheets open for you"
          rows={rows.map(
            (p): ListRow => ({
              id: p.id,
              title: `${p.subjectName} · ${p.sectionLabel}`,
              meta: p.examName,
              href: `${basePath}/exams/${p.examId}/papers/${p.id}`,
              badge: { label: p.examStatus === "verification" ? "Verification" : "Marks entry", variant: examStatusVariant(p.examStatus) },
            }),
          )}
        />
      ),
      "Marks to enter",
    );

  const assignmentsWidget =
    canReadAssignments &&
    settled(
      assignmentsR,
      () => (
        <ListWidget
          title="Assignments"
          icon={<ClipboardList />}
          action={{ href: `${basePath}/assignments`, label: "View all" }}
          emptyTitle="No active assignments"
          rows={activeAssignments
            .slice(0, 5)
            .map(
              (a): ListRow => ({
                id: a.id,
                title: a.title,
                meta: a.dueAt ? `Due ${shortDate.format(new Date(a.dueAt))}` : "No due date",
                href: `${basePath}/assignments/${a.id}`,
                badge: { label: a.status === "published" ? "Published" : "Draft", variant: assignmentStatusVariant(a.status) },
              }),
            )}
        />
      ),
      "Assignments",
    );

  const notificationsWidget =
    canReadNotifications &&
    settled(
      notificationsR,
      (rows) => (
        <ListWidget
          title="Notifications"
          action={{ href: `${basePath}/notifications`, label: "View all" }}
          emptyTitle="You're all caught up"
          rows={rows.map(
            (n): ListRow => ({
              id: n.id,
              title: n.title,
              meta: `${shortDate.format(new Date(n.createdAt))} · ${n.body}`,
              badge: n.readAt ? undefined : { label: "New", variant: "info" },
            }),
          )}
        />
      ),
      "Notifications",
    );

  const noticesWidget = settled(
    noticesR,
    (rows) => (
      <ListWidget
        title="Announcements"
        icon={<Megaphone />}
        emptyTitle="No announcements"
        rows={rows.map((n): ListRow => ({ id: n.id, title: n.title, meta: shortDate.format(new Date(n.publishAt)) }))}
      />
    ),
    "Announcements",
  );

  const eventsWidget = settled(
    eventsR,
    (rows) => (
      <ListWidget
        title="Upcoming events"
        emptyTitle="No upcoming events"
        rows={rows.map(
          (e): ListRow => ({ id: e.id, title: e.title, meta: [shortDate.format(new Date(e.startsAt)), e.location].filter(Boolean).join(" · ") }),
        )}
      />
    ),
    "Upcoming events",
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={greeting(now, ctx.user.profile.fullName)}
        description={dayLabel.format(now)}
        actions={
          pending[0] && (
            <Button asChild className="sm:h-10 sm:px-4">
              <Link href={registerHref(pending[0].id)}>
                <ClipboardCheck className="size-4" aria-hidden />
                Mark {pending[0].label} attendance
              </Link>
            </Button>
          )
        }
      />

      <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <StaggerItem key={k.label}>
            <KpiTile label={k.label} value={k.n === undefined ? "—" : String(k.n)} animateTo={k.n} href={k.href} />
          </StaggerItem>
        ))}
      </Stagger>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          {sectionsWidget}
          {timetable && <TimetableWidget className="lg:order-first" title="Today's timetable" description={dayLabel.format(now)} periods={timetable} />}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {papersWidget}
          {assignmentsWidget}
          <QuickActions actions={quickActions} />
          {insights.map((insight) => (
            <AIInsightCard key={insight.title} {...insight} />
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {notificationsWidget}
        {noticesWidget}
        {eventsWidget}
      </div>
    </div>
  );
}
