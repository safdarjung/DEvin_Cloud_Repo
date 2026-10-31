// Demo-tenant fixtures: plausible placeholder data for widgets the seed does not
// cover (CLAUDE.md rule 7 exception). Pure and deterministic — output depends only
// on the arguments (a string key, and "today" passed in), never on the clock.
// Callers MUST gate every call behind demoFixturesEnabled(ctx).
import type { AIInsightCardProps } from "@/components/widgets/ai-insight-card";
import type { ApprovalRow } from "@/components/widgets/approvals-widget";
import type { StaffAvailability } from "@/components/widgets/staff-availability-widget";
import type { TimetablePeriod } from "@/components/widgets/timetable-widget";
import { inr } from "@/lib/format";
import type { TenantContext } from "@/lib/auth/types";

export const demoFixturesEnabled = (ctx: Pick<TenantContext, "institution">): boolean => ctx.institution.is_demo === true;

// FNV-1a string hash -> mulberry32 (same generator as scripts/seed/lib/prng.ts).
function rng(key: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < key.length; i++) a = Math.imul(a ^ key.charCodeAt(i), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const TZ = "Asia/Kolkata";
const ist = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
const label = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const parts = (d: Date) => {
  const p = Object.fromEntries(ist.formatToParts(d).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, minutes: Number(p.hour) * 60 + Number(p.minute) };
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// 45-min periods, 15-min short break, 40-min lunch: 08:00-14:10.
const SLOTS: { start: number; end: number; kind: "period" | "break" }[] = [
  [480, 525], [525, 570], [570, 615], [615, 630, 1], [630, 675], [675, 720], [720, 760, 1], [760, 805], [805, 850],
].map(([start, end, brk]) => ({ start, end, kind: brk ? ("break" as const) : ("period" as const) }));

/** `day` is also "now": the row containing its IST time is current (else the next row is next). */
export function demoTimetable({ day, entries }: { day: Date; entries: { title: string; subtitle?: string }[] }): TimetablePeriod[] {
  const { minutes, weekday } = parts(day);
  const offset = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  let n = 0;
  const rows = SLOTS.map((s) => {
    if (s.kind === "break") {
      return { start: hhmm(s.start), end: hhmm(s.end), title: s.start === 615 ? "Short break" : "Lunch break" };
    }
    const e = entries.length ? entries[(n++ + offset) % entries.length] : { title: `Period ${n}` };
    return { start: hhmm(s.start), end: hhmm(s.end), title: e.title, subtitle: e.subtitle };
  });
  const cur = SLOTS.findIndex((s) => minutes >= s.start && minutes < s.end);
  const next = cur >= 0 ? -1 : SLOTS.findIndex((s) => s.start > minutes);
  return rows.map((r, i) => ({ ...r, ...(i === cur ? { isCurrent: true } : i === next ? { isNext: true } : {}) }));
}

/** School-day (Mon-Sat) attendance %, 88-97, mean-reverting around `base`. */
export function demoAttendanceTrend({ key, days, endDate, base = 93 }: { key: string; days: number; endDate: Date; base?: number }): { label: string; value: number }[] {
  const r = rng(`attendance:${key}`);
  const out: { label: string; value: number }[] = [];
  let v = base;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endDate.getTime() - i * 86_400_000);
    if (parts(d).weekday === "Sun") continue;
    v = Math.min(97, Math.max(88, v + (base - v) * 0.3 + (r() - 0.5) * 4));
    out.push({ label: label.format(d), value: Math.round(v * 10) / 10 });
  }
  return out;
}

const STAFF = [
  ["Sunita Sharma", "Class Teacher, 6-A"], ["Rajesh Iyer", "Mathematics"], ["Meena Nair", "English"], ["Amit Verma", "Science"],
  ["Pooja Reddy", "Hindi"], ["Faisal Khan", "Physical Education"], ["Kavita Joshi", "Social Studies"], ["Suresh Patel", "Computer Science"],
  ["Anjali Menon", "Accounts"], ["Harpreet Singh", "Librarian"],
] as const;

export function demoStaffAvailability(key: string): StaffAvailability {
  const r = rng(`staff:${key}`);
  const total = 36 + Math.floor(r() * 10);
  const pool = [...STAFF].sort(() => r() - 0.5).slice(0, 2 + Math.floor(r() * 3));
  const onLeaveStaff = pool.map(([name, role]) => {
    const d = 1 + Math.floor(r() * 3);
    return { name, role, until: d === 1 ? "Back tomorrow" : `Back in ${d} days` };
  });
  const absent = Math.floor(r() * 3);
  return { present: total - onLeaveStaff.length - absent, onLeave: onLeaveStaff.length, absent, onLeaveStaff };
}

const APPROVALS = [
  { kind: "leave", title: "Casual leave, 2 days", by: ["Rajesh Iyer", "Meena Nair", "Pooja Reddy"] },
  { kind: "fee_waiver", title: "Fee waiver request, Term 2", by: ["Anjali Menon", "Sunita Sharma"] },
  { kind: "tc", title: "Transfer certificate request", by: ["Harpreet Singh", "Sunita Sharma"] },
  { kind: "event", title: "Annual Day rehearsal schedule", by: ["Faisal Khan", "Kavita Joshi"] },
] as const;

const ageLabel = (from: Date, now: Date) => {
  const h = Math.round((now.getTime() - from.getTime()) / 3_600_000);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
};

export function demoApprovals(key: string, now: Date): ApprovalRow[] {
  const r = rng(`approvals:${key}`);
  return APPROVALS.map((a, i) => {
    const hours = 1 + Math.floor(r() * 70);
    const requestedAt = new Date(now.getTime() - hours * 3_600_000);
    return { id: `demo-approval-${i}`, kind: a.kind, title: a.title, requestedBy: pick(r, a.by), age: ageLabel(requestedAt, now) };
  });
}

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
