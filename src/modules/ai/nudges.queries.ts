import "server-only";
// Ask AI orb nudges. Every source is an owner's existing query under the caller's own RLS client,
// included only when the caller holds that query's permission and the module is on. Nothing is invented.
import type { TenantContext } from "@/lib/auth/types";
import { hasPermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { listStudentAssignments } from "@/modules/academics/assignments.queries";
import { mySubmissions } from "@/modules/academics/submissions.queries";
import { rankNudges, type Nudge } from "./nudges";
import { pendingApprovals } from "@/modules/core/approvals.queries";
import { attendanceDailyCounts, getTodaySectionsForTeacher, todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { listDefaulters, listAcademicYears, listInvoicesForStudent } from "@/modules/finance/queries";
import { listMyNotifications } from "@/modules/notifications/queries";
import { priorityActions } from "@/modules/insights/derived";
import { getCurrentTermId, getMyStudent, listMyChildren } from "@/modules/people/queries";
import { upcomingExamsForStudent } from "@/modules/exams/queries";
import { libraryMyLoans } from "@/modules/library/queries";
import { daysBetween, istDay } from "@/modules/people/portal-dates";

type Source = () => Promise<Nudge[]>;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function approvalsSource(ctx: TenantContext): Source {
  return async () => {
    const rows = await pendingApprovals(ctx); // gates each approval source by its own permission + module
    if (rows.length === 0) return [];
    return [{
      id: `approvals:${rows[0]!.id}`,
      kind: "alert",
      text: `${plural(rows.length, "approval")} waiting for your decision.`,
      href: rows[0]!.href ?? `/${ctx.institution.slug}/dashboard`,
      ask: "What approvals are waiting for me and which should I handle first?",
    }];
  };
}

function attendanceSource(ctx: TenantContext): Source {
  return async () => {
    const date = todayInInstitutionTimezone(ctx);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) return []; // Sunday: no register expected
    const [mine, counts] = await Promise.all([
      getTodaySectionsForTeacher(ctx),
      attendanceDailyCounts(ctx, { from: date, to: date, bySection: true }),
    ]);
    const marked = new Set(counts.map((c) => c.classSectionId));
    const missing = mine.filter((s) => !marked.has(s.id));
    if (missing.length === 0) return [];
    const labels = missing.slice(0, 3).map((s) => s.label).join(", ");
    return [{
      id: `attendance-unmarked:${date}:${missing.map((s) => s.id).sort().join(",").slice(0, 80)}`,
      kind: "alert",
      text: `Attendance not marked today for ${labels}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}.`,
      href: `/${ctx.institution.slug}/attendance`,
      ask: "Which sections have not had attendance marked today?",
    }];
  };
}

function notificationsSource(ctx: TenantContext): Source {
  return async () => {
    const unread = (await listMyNotifications(ctx, 30)).filter((n) => !n.readAt);
    const out: Nudge[] = unread
      .filter((n) => n.type === "safety_alert")
      .slice(0, 2)
      .map((n) => ({
        id: `notif:${n.id}`,
        kind: "alert" as const,
        text: `Safety alert: ${n.title}`,
        href: `/${ctx.institution.slug}/notifications`,
        ask: "Summarise my unread safety alerts and what I should do.",
      }));
    const rest = unread.filter((n) => n.type !== "safety_alert");
    if (rest.length > 0) {
      out.push({
        id: `notif-unread:${rest[0]!.id}`,
        kind: "suggestion",
        text: `You have ${plural(rest.length, "unread notification")}. Catch up?`,
        href: `/${ctx.institution.slug}/notifications`,
        ask: "Summarise my unread notifications.",
      });
    }
    return out;
  };
}

function overdueFeesSource(ctx: TenantContext): Source {
  return async () => {
    const year = (await listAcademicYears(ctx))[0];
    const termId = year ? await getCurrentTermId(ctx, year.id) : null;
    if (!termId) return [];
    const today = todayInInstitutionTimezone(ctx);
    const overdue = (await listDefaulters(ctx, { termId })).filter((d) => d.dueOn !== null && d.dueOn < today);
    if (overdue.length === 0) return [];
    return [{
      id: `fees-overdue:${overdue[0]!.invoiceId}`,
      kind: "suggestion",
      text: `${plural(overdue.length, "invoice")} overdue this term. Send reminders?`,
      href: `/${ctx.institution.slug}/finance/defaulters`,
      ask: "Which fee invoices are overdue this term and who should I remind first?",
    }];
  };
}

function insightsSource(ctx: TenantContext): Source {
  return async () => {
    const actions = await priorityActions(ctx);
    return actions.slice(0, 2).map((a) => ({
      id: `insight:${a.id}`,
      kind: a.severity === "critical" ? ("alert" as const) : ("insight" as const),
      text: a.title,
      href: a.href,
      ask: `Explain this insight and what to do next: ${a.title}`,
    }));
  };
}

// Portal: one source per child (guardian) or self (student). The child queries already limit rows to that student or their guardian.
function childSource(ctx: TenantContext, child: { id: string; firstName: string }, prefixName: boolean): Source {
  return async () => {
    const slug = ctx.institution.slug;
    const who = prefixName ? `${child.firstName}: ` : "";
    const q = `?student=${child.id}`;
    const today = istDay(new Date());
    const tasks: Promise<Nudge[]>[] = [];
    if (isModuleEnabled(ctx, "assignments") && hasPermission(ctx, "assignment.read")) {
      tasks.push(
        Promise.all([
          listStudentAssignments(ctx, child.id),
          ctx.membership.role === "student" ? mySubmissions(ctx, child.id) : Promise.resolve([]),
        ]).then(([all, subs]) => {
          const done = new Set(subs.filter((s) => s.state !== "not_submitted").map((s) => s.assignmentId));
          return all
            .filter((a) => a.status === "published" && a.dueAt && !done.has(a.id) && daysBetween(today, istDay(a.dueAt)) >= 0 && daysBetween(today, istDay(a.dueAt)) <= 3)
            .slice(0, 1)
            .map((a) => ({
              id: `assignment:${a.id}`, kind: "alert" as const, text: `${who}"${a.title}" is due within 3 days.`,
              href: `/${slug}/portal/assignments${q}`, ask: `What is due soon for ${child.firstName}, and how should they plan it?`,
            }));
        }),
      );
    }
    if (isModuleEnabled(ctx, "exams") && hasPermission(ctx, "exam.result.read")) {
      tasks.push(upcomingExamsForStudent(ctx, child.id, 7).then((e) => e.slice(0, 1).map((x) => ({
        id: `exam:${x.paperId}`, kind: "suggestion" as const, text: `${who}${x.subjectName} exam on ${istDay(x.scheduledAt)}. Revise?`,
        href: `/${slug}/portal/exams${q}`, ask: `Help ${child.firstName} prepare for the upcoming ${x.subjectName} exam.`,
      }))));
    }
    if (isModuleEnabled(ctx, "library") && hasPermission(ctx, "library.read")) {
      tasks.push(libraryMyLoans(ctx, { studentId: child.id }).then((l) => l
        .filter((b) => !b.returnedOn && daysBetween(today, b.dueOn) <= 2).slice(0, 1).map((b) => ({
          id: `loan:${b.loanId}`, kind: "alert" as const, text: `${who}"${b.title}" is ${b.daysOverdue > 0 ? "overdue" : "due soon"} at the library.`,
          href: `/${slug}/portal/library${q}`, ask: "Which library books are due or overdue?",
        }))));
    }
    if (isModuleEnabled(ctx, "fees") && hasPermission(ctx, "finance.read")) {
      tasks.push(listInvoicesForStudent(ctx, child.id).then((inv) => {
        const due = inv.filter((i) => i.total - i.paidTotal > 0 && i.dueOn !== null && i.dueOn <= today);
        return due.length === 0 ? [] : [{
          id: `fee-due:${due[0]!.id}`, kind: "alert" as const, text: `${who}${plural(due.length, "fee invoice")} due or overdue.`,
          href: `/${slug}/portal/fees${q}`, ask: "Which fee invoices are due and how can I pay?",
        }];
      }));
    }
    return (await Promise.allSettled(tasks)).flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  };
}

async function portalSourceList(ctx: TenantContext): Promise<Source[]> {
  if (ctx.membership.role === "student") {
    const me = await getMyStudent(ctx);
    return me ? [childSource(ctx, me, false)] : [];
  }
  const kids = (await listMyChildren(ctx)).slice(0, 3);
  return kids.map((k) => childSource(ctx, k, true));
}

function staffSources(ctx: TenantContext): Source[] {
  const can = (p: Parameters<typeof hasPermission>[1], m?: Parameters<typeof isModuleEnabled>[1]) =>
    hasPermission(ctx, p) && (!m || isModuleEnabled(ctx, m));
  return [
    approvalsSource(ctx), // self-gating, see pendingApprovals
    can("attendance.mark", "attendance") && attendanceSource(ctx),
    can("finance.read", "fees") && can("dashboard.view") && overdueFeesSource(ctx),
    can("insight.review", "insights") && insightsSource(ctx),
  ].filter((s): s is Source => s !== false);
}

/** At most 8 nudges for the signed-in user. A failing source drops only its own nudges. */
export async function getAskAiNudges(ctx: TenantContext): Promise<Nudge[]> {
  const isPortal = ctx.membership.role === "student" || ctx.membership.role === "guardian";
  const sources: Source[] = [];
  if (hasPermission(ctx, "notification.read")) sources.push(notificationsSource(ctx));
  if (isPortal) {
    const portal = await Promise.allSettled([portalSourceList(ctx)]);
    if (portal[0].status === "fulfilled") sources.push(...portal[0].value);
  } else {
    sources.push(...staffSources(ctx));
  }
  const settled = await Promise.allSettled(sources.map((s) => s()));
  return rankNudges(settled.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
}
