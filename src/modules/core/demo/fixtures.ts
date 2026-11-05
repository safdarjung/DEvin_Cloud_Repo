// Demo-tenant fixtures: plausible placeholder data for widgets the seed does not
// cover (CLAUDE.md rule 7 exception). Pure and deterministic — output depends only
// on the arguments (a string key, and "today" passed in), never on the clock.
// Callers MUST gate every call behind demoFixturesEnabled(ctx).
import type { AIInsightCardProps } from "@/components/widgets/ai-insight-card";
import { inr } from "@/lib/format";
import type { TenantContext } from "@/lib/auth/types";

export const demoFixturesEnabled = (ctx: Pick<TenantContext, "institution">): boolean => ctx.institution.is_demo === true;

export type InsightRole = "principal" | "admissions" | "accountant" | "exam_controller" | "teacher" | "student" | "guardian";
/** Real numbers from the page, so insight wording matches what the user sees. */
export interface InsightFacts {
  attendancePct?: number;
  lowAttendanceSections?: number;
  openEnquiries?: number;
  outstandingFees?: number; // rupees
  overdueInvoices?: number;
  pendingMarks?: number;
  /** e.g. "/st-josephs-demo"; when set, suggested actions link to the module. */
  basePath?: string;
}

export function demoInsights(role: InsightRole, f: InsightFacts): AIInsightCardProps[] {
  const to = (path: string) => (f.basePath ? `${f.basePath}${path}` : undefined);
  const att = f.attendancePct !== undefined ? `${f.attendancePct}%` : "below the usual level";
  const fees = f.outstandingFees !== undefined ? inr(f.outstandingFees) : "a sizeable amount";
  const enq = f.openEnquiries !== undefined ? `${f.openEnquiries} open enquiries` : "several open enquiries";
  const byRole: Record<InsightRole, AIInsightCardProps[]> = {
    principal: [
      { title: "Attendance dip", detected: `Attendance is ${att} this week, ${f.lowAttendanceSections !== undefined ? `with ${f.lowAttendanceSections} sections below target` : "with a few sections lagging"}.`, whyItMatters: "Repeated absence early in the term is the strongest signal of later learning gaps.", evidence: ["Daily attendance, last 7 school days", "Section-wise comparison against the school average"], suggestedAction: { label: "Review attendance", href: to("/attendance") }, confidence: "medium" },
      { title: "Pending approvals piling up", detected: "Leave and fee-waiver requests are waiting more than a day.", whyItMatters: "Slow decisions leave classes without cover and parents without answers.", evidence: ["Oldest request is 2 days old"], suggestedAction: { label: "Open dashboard", href: to("/dashboard") }, requiresApproval: true, confidence: "high" },
    ],
    admissions: [
      { title: "Enquiries going cold", detected: `${enq}, some not contacted for over a week.`, whyItMatters: "Enquiries contacted within 48 hours convert far more often.", evidence: ["Last-contact date per enquiry"], suggestedAction: { label: "Follow up now", href: to("/admissions") }, confidence: "high" },
      { title: "Campus visits to schedule", detected: "Several enquiries asked about a campus visit but have none booked.", whyItMatters: "Families who visit are more likely to apply.", evidence: ["Enquiry notes mentioning a visit"], suggestedAction: { label: "Schedule visits", href: to("/admissions") }, confidence: "medium" },
    ],
    accountant: [
      { title: "Overdue fees", detected: `${fees} is outstanding${f.overdueInvoices ? ` across ${f.overdueInvoices} overdue invoices` : ""}.`, whyItMatters: "Cash flow for salaries and utilities depends on timely collection.", evidence: ["Invoices past due date"], suggestedAction: { label: "Review invoices", href: to("/finance") }, requiresApproval: true, confidence: "high" },
      { title: "Reminder timing", detected: "Reminders sent in the first week of the month are collected faster.", whyItMatters: "Better timing reduces follow-up calls.", evidence: ["Collections vs reminder dates, last 3 months"], suggestedAction: { label: "Plan reminders", href: to("/finance") }, confidence: "low" },
    ],
    exam_controller: [
      { title: "Marks entry incomplete", detected: f.pendingMarks !== undefined ? `${f.pendingMarks} marks sheets are still pending.` : "Some marks sheets are still pending.", whyItMatters: "Results cannot be published until every sheet is submitted.", evidence: ["Submission status per subject"], suggestedAction: { label: "Open exams", href: to("/exams") }, confidence: "high" },
      { title: "Moderation check", detected: "One subject's average is well above the other subjects in the same class.", whyItMatters: "Large gaps can indicate marking leniency or an easy paper.", evidence: ["Subject averages for the term"], suggestedAction: { label: "Review marks", href: to("/exams") }, requiresApproval: true, confidence: "medium" },
    ],
    teacher: [
      { title: "Students to check in on", detected: "A few students in your classes have missed several days this month.", whyItMatters: "A quick word early often prevents a longer absence.", evidence: ["Absences in the last 14 days"], suggestedAction: { label: "Open attendance", href: to("/attendance") }, confidence: "medium" },
      { title: "Assignments awaiting review", detected: "Submitted work is waiting for feedback.", whyItMatters: "Timely feedback improves the next submission.", evidence: ["Submissions without feedback"], suggestedAction: { label: "Open assignments", href: to("/assignments") }, confidence: "high" },
    ],
    student: [
      { title: "Upcoming deadlines", detected: "You have assignments due this week.", whyItMatters: "Starting early leaves time to ask for help.", evidence: ["Assignments due in the next 7 days"], suggestedAction: { label: "View assignments", href: to("/portal") }, confidence: "high" },
      { title: "Attendance check", detected: `Your attendance is ${att}.`, whyItMatters: "Most schools expect at least 75% to sit exams.", evidence: ["Attendance this term"], suggestedAction: { label: "View attendance", href: to("/portal") }, confidence: "medium" },
    ],
    guardian: [
      { title: "Fees due soon", detected: f.outstandingFees !== undefined ? `${fees} is due for your child.` : "A fee instalment is due soon.", whyItMatters: "Paying on time avoids late charges.", evidence: ["Invoice due dates"], suggestedAction: { label: "View fees", href: to("/portal") }, confidence: "high" },
      { title: "Attendance this month", detected: `Your child's attendance is ${att}.`, whyItMatters: "Regular attendance supports steady progress.", evidence: ["Attendance this term"], suggestedAction: { label: "View attendance", href: to("/portal") }, confidence: "medium" },
    ],
  };
  return byRole[role];
}
