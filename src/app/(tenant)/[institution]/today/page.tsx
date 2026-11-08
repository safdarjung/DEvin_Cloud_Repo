import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpenCheck, CalendarDays, ClipboardCheck, ClipboardList, FilePlus2, FileCheck2, Megaphone, PenLine } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AIInsightCard } from "@/components/widgets/ai-insight-card";
import { KpiStrip, KpiTile } from "@/components/widgets/kpi-widget";
import { ListWidget, type ListRow } from "@/components/widgets/list-widget";
import { QuickActions, type QuickAction } from "@/components/widgets/quick-actions";
import { TimetableWidget } from "@/components/widgets/timetable-widget";
import { AnimatedList, ProgressBar } from "@/components/widgets/viz";
import { Widget } from "@/components/widgets/widget";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listTeacherAssignments } from "@/modules/academics/assignments.queries";
import { curriculumCoverageBySection } from "@/modules/academics/curriculum.queries";
import { submissionsForAssignment } from "@/modules/academics/submissions.queries";
import { assignmentStatusVariant } from "@/modules/academics/status";
import { getSession, getTodaySectionsForTeacher } from "@/modules/attendance/queries";
import { getMyPapers } from "@/modules/exams/queries";
import { insightCards } from "@/modules/insights/derived";
import { examStatusVariant } from "@/modules/exams/status";
import { listMyNotifications } from "@/modules/notifications/queries";
import { ptmEvents, ptmTeacherSchedule } from "@/modules/ptm/queries";
import { StudentLeaveReview } from "@/modules/student-leave/components/StudentLeaveReview";
import { studentLeaveRequests } from "@/modules/student-leave/queries";
import { timetableTodayFor } from "@/modules/timetable/queries";
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
  const staffId = ctx.membership.staffId;
  const canReviewLeave = hasPermission(ctx, "student_leave.approve") && isModuleEnabled(ctx, "student_leave");
  const canSeePtm = hasPermission(ctx, "ptm.slot.manage") && isModuleEnabled(ctx, "ptm") && Boolean(staffId);
  const canSeeCoverage = canReadAssignments && isModuleEnabled(ctx, "lesson_plans") && Boolean(staffId);

  const [sectionsR, papersR, assignmentsR, notificationsR, noticesR, eventsR, timetableR, leaveR, ptmR, coverageR] = await Promise.allSettled([
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
    isModuleEnabled(ctx, "timetable") ? timetableTodayFor(ctx) : Promise.resolve([]),
    // RLS scopes leave, PTM slots and coverage to what this teacher may see; the teacherId filter keeps coverage to their own subjects.
    canReviewLeave ? studentLeaveRequests(ctx, { status: "pending", limit: 8 }) : Promise.resolve([]),
    canSeePtm
      ? ptmEvents(ctx).then(async (events) => {
          const upcoming = events.filter((e) => e.status === "published").slice(0, 2);
          const schedules = await Promise.all(upcoming.map((e) => ptmTeacherSchedule(ctx, e.id)));
          return upcoming.map((event, i) => ({ event, slots: schedules[i] }));
        })
      : Promise.resolve([]),
    canSeeCoverage ? curriculumCoverageBySection(ctx, { teacherId: staffId ?? undefined }) : Promise.resolve([]),
  ]);

  // Submissions awaiting a grade: one roster read per published assignment, capped (shortcut: no cross-assignment aggregate query yet).
  const toGradeR = await Promise.allSettled(
    (assignmentsR.status === "fulfilled" && canManageAssignments ? assignmentsR.value.filter((a) => a.status === "published").slice(0, 5) : []).map(
      async (a) => ({ assignment: a, count: (await submissionsForAssignment(ctx, a.id)).filter((r) => r.state === "submitted").length }),
    ),
  );
  const toGrade = toGradeR.flatMap((r) => (r.status === "fulfilled" && r.value.count > 0 ? [r.value] : []));
  const toGradeTotal = toGrade.reduce((n, r) => n + r.count, 0);

  const sections = sectionsR.status === "fulfilled" ? sectionsR.value : [];
  const papers = papersR.status === "fulfilled" ? papersR.value : [];
  const activeAssignments = assignmentsR.status === "fulfilled" ? assignmentsR.value.filter((a) => a.status !== "closed") : [];
  const pending = sections.filter((s) => s.status !== "submitted");
  const registerHref = (sectionId: string) => `${basePath}/attendance/${sectionId}?date=${today}`;

  // Real insights (RLS narrows a teacher to their taught sections); a failed query
  // shows nothing rather than invented cards.
  const insights =
    hasPermission(ctx, "insight.read") && isModuleEnabled(ctx, "insights")
      ? await insightCards(ctx, { limit: 3 }).catch((e: unknown) => {
          console.error("today insights fetch failed:", e instanceof Error ? e.message : e);
          return [];
        })
      : [];

  const quickActions: QuickAction[] = [
    ...(canManageAssignments ? [{ href: `${basePath}/assignments/new`, label: "New assignment", icon: <FilePlus2 className="size-4" /> }] : []),
    ...(canReadAssignments ? [{ href: `${basePath}/assignments`, label: "All assignments", icon: <ClipboardList className="size-4" /> }] : []),
    ...(canEnterMarks ? [{ href: `${basePath}/exams`, label: "Exams", icon: <PenLine className="size-4" /> }] : []),
    ...(canSeeCoverage ? [{ href: `${basePath}/lesson-plans`, label: "Lesson plans", icon: <BookOpenCheck className="size-4" /> }] : []),
    ...(hasPermission(ctx, "diary.write") && isModuleEnabled(ctx, "diary") ? [{ href: `${basePath}/diary`, label: "Class diary", icon: <Megaphone className="size-4" /> }] : []),
    ...(hasPermission(ctx, "question.manage") && isModuleEnabled(ctx, "question_bank") ? [{ href: `${basePath}/question-bank`, label: "Question bank", icon: <ClipboardList className="size-4" /> }] : []),
  ];

  const leaveRows = leaveR.status === "fulfilled" ? leaveR.value : [];
  const kpis = [
    { label: "Sections today", n: sectionsR.status === "fulfilled" ? sections.length : undefined, href: `${basePath}/attendance` },
    { label: "Registers pending", n: sectionsR.status === "fulfilled" ? pending.length : undefined, href: `${basePath}/attendance` },
    canEnterMarks && { label: "Marks to enter", n: papersR.status === "fulfilled" ? papers.length : undefined, href: `${basePath}/exams` },
    canReadAssignments && {
      label: "Active assignments",
      n: assignmentsR.status === "fulfilled" ? activeAssignments.length : undefined,
      href: `${basePath}/assignments`,
    },
    canManageAssignments && { label: "Submissions to grade", n: assignmentsR.status === "fulfilled" ? toGradeTotal : undefined, href: `${basePath}/assignments` },
    canReviewLeave && { label: "Leave requests", n: leaveR.status === "fulfilled" ? leaveRows.length : undefined, href: `${basePath}/today#leave` },
  ].filter((k) => !!k);

  const sectionsWidget = settled(
    sectionsR,
    (rows) => (
      <Widget
        title="Today's registers"
        description={rows.length ? `${pending.length} of ${rows.length} still to submit` : undefined}
        icon={<ClipboardCheck />}
        isEmpty={rows.length === 0}
        empty={<EmptyState bare title="No sections to mark today" />}
      >
        <ProgressBar
          label="Registers submitted"
          value={rows.length - pending.length}
          max={rows.length}
          valueLabel={`${rows.length - pending.length} of ${rows.length}`}
          tone={pending.length === 0 ? "success" : "default"}
          className="mb-2"
        />
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

  // M16 security review (LOW): the query resolves to [] (fulfilled), not
  // skipped, when the module is off, so gate the widget itself — same
  // permission-gated pattern as papersWidget below — instead of relying on
  // an always-empty result to hide it.
  const timetableWidget =
    isModuleEnabled(ctx, "timetable") &&
    settled(
      timetableR,
      (periods) => <TimetableWidget title="Today's timetable" description={dayLabel.format(now)} periods={periods} />,
      "Today's timetable",
    );

  const papersWidget =
    canEnterMarks &&
    settled(
      papersR,
      (rows) => (
        <Widget title="Marks to enter" icon={<PenLine />} isEmpty={rows.length === 0} empty={<EmptyState bare title="No marks sheets open for you" />}>
          <AnimatedList ariaLabel="Marks to enter" className="space-y-0 divide-y">
            {rows.map((p) => (
              <Link
                key={p.id}
                href={`${basePath}/exams/${p.examId}/papers/${p.id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-md py-2 outline-none transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{`${p.subjectName} · ${p.sectionLabel}`}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.examName}</span>
                </span>
                <Badge variant={examStatusVariant(p.examStatus)}>{p.examStatus === "verification" ? "Verification" : "Marks entry"}</Badge>
              </Link>
            ))}
          </AnimatedList>
        </Widget>
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

  const submissionsWidget =
    canManageAssignments &&
    assignmentsR.status === "fulfilled" && (
      <ListWidget
        title="Submissions to grade"
        icon={<FileCheck2 />}
        emptyTitle="Nothing waiting to be graded"
        rows={toGrade.map(
          (r): ListRow => ({
            id: r.assignment.id,
            title: r.assignment.title,
            meta: `${r.count} submitted`,
            href: `${basePath}/assignments/${r.assignment.id}`,
            badge: { label: "Grade", variant: "info" },
          }),
        )}
      />
    );

  const leaveWidget =
    canReviewLeave &&
    settled(
      leaveR,
      (rows) => (
        <div id="leave" className="scroll-mt-24">
          <Widget title="Student leave requests" description={rows.length ? `${rows.length} waiting for you` : undefined}>
            <StudentLeaveReview
              institutionSlug={institutionSlug}
              requests={rows.map((r) => ({
                id: r.id,
                studentName: r.studentName,
                classSection: r.classSection,
                startDate: r.startDate,
                endDate: r.endDate,
                days: r.days,
                reason: r.reason,
              }))}
            />
          </Widget>
        </div>
      ),
      "Student leave requests",
    );

  const ptmWidget =
    canSeePtm &&
    settled(
      ptmR,
      (groups) => (
        <ListWidget
          title="Parent meetings"
          icon={<CalendarDays />}
          action={{ href: `${basePath}/ptm`, label: "Manage slots" }}
          emptyTitle="No published meetings"
          rows={groups.flatMap(({ event, slots }) =>
            slots.length === 0
              ? [{ id: event.id, title: event.title, meta: `${shortDate.format(new Date(`${event.eventDate}T00:00:00Z`))} · you have no slots yet`, href: `${basePath}/ptm` } satisfies ListRow]
              : slots
                  .filter((s) => s.booking)
                  .map(
                    (s): ListRow => ({
                      id: s.slotId,
                      title: `${s.startsAt} · ${s.booking?.studentName ?? ""}`,
                      meta: `${event.title} · ${shortDate.format(new Date(`${event.eventDate}T00:00:00Z`))}`,
                    }),
                  ),
          )}
        />
      ),
      "Parent meetings",
    );

  const coverageWidget =
    canSeeCoverage &&
    settled(
      coverageR,
      (rows) => (
        <Widget
          title="Syllabus coverage"
          icon={<BookOpenCheck />}
          action={{ href: `${basePath}/lesson-plans`, label: "Lesson plans" }}
          isEmpty={rows.length === 0}
          empty={<EmptyState bare title="No curriculum units set for your subjects" />}
        >
          <ul className="space-y-3">
            {rows.map((c) => (
              <li key={`${c.section_label}:${c.subject}`}>
                <ProgressBar
                  label={`${c.subject} · ${c.section_label}`}
                  value={c.completed_units}
                  max={Math.max(c.planned_units, 1)}
                  valueLabel={`${c.completed_units} of ${c.planned_units} units${c.planned_units === 0 ? "" : c.on_track ? " · On track" : " · Behind"}`}
                  tone={c.planned_units === 0 ? "default" : c.on_track ? "success" : "warning"}
                />
              </li>
            ))}
          </ul>
        </Widget>
      ),
      "Syllabus coverage",
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

      {kpis.length > 0 && (
        <KpiStrip>
          {kpis.map((k) => (
            <KpiTile key={k.label} label={k.label} value={k.n === undefined ? "—" : String(k.n)} animateTo={k.n} href={k.href} />
          ))}
        </KpiStrip>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          {sectionsWidget}
          {timetableWidget}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {papersWidget}
          {submissionsWidget}
          {leaveWidget}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[
          ptmWidget,
          coverageWidget,
          assignmentsWidget,
          quickActions.length > 0 && <QuickActions actions={quickActions} />,
          ...insights.map((insight) => <AIInsightCard key={insight.title} {...insight} />),
          notificationsWidget,
          noticesWidget,
          eventsWidget,
        ].map((node, i) => node && <div key={i} className="min-w-0 [&>*]:h-full">{node}</div>)}
      </div>
    </div>
  );
}
