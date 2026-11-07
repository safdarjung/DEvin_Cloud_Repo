import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  BarChart3,
  Bell,
  Book,
  BookOpen,
  BookText,
  Bot,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  CalendarClock,
  CalendarOff,
  ClipboardList,
  Cog,
  Cpu,
  Database,
  FileText,
  Globe,
  GraduationCap,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  ListChecks,
  NotebookPen,
  NotebookText,
  Palette,
  Puzzle,
  Shield,
  Sparkles,
  Store,
  Sun,
  Target,
  TrendingUp,
  UserCircle,
  Users,
  Zap,
} from "lucide-react";
import type { Permission, Role } from "@/lib/auth/permissions";
import type { ModuleKey } from "@/lib/modules/catalog";
import { isModuleEnabled } from "@/lib/modules/catalog";

export type NavGroup =
  | "Overview" | "Academics" | "Operations" | "Communication" | "Admin" | "Fabric" | "Personal"
  // Portal-only sections (student / guardian sidebars).
  | "My child" | "Learning" | "Academic" | "Updates";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  group: NavGroup;
  module?: ModuleKey;
  /** Fabric page backed only by fixtures: kept in code, never listed in nav (even on demo tenants). */
  demoOnly?: boolean;
}

// Lead-owned (09 §4): lanes add one line each as their module lands. Filtered
// by the signed-in member's permissions, not by role name directly. Keep items
// of one group contiguous: the sidebar renders a section per run of equal groups.
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view", group: "Overview" },
  // Teacher landing (staff without dashboard.view); see navItemsFor.
  { href: "/today", label: "Today", icon: Sun, permission: "attendance.mark", group: "Overview" },
  // No dedicated "portal.view" permission exists (07 §2.2); exam.recheck.request
  // is the only row granted to exactly {student, guardian} and no staff role,
  // which is exactly who the portal link is for.
  { href: "/assistant", label: "Ask the data", icon: MessageSquare, permission: "dashboard.view", group: "Overview", module: "ai_teacher" },
  { href: "/portal", label: "Portal", icon: UserCircle, permission: "exam.recheck.request", group: "Overview" },
  { href: "/students", label: "Students", icon: Users, permission: "student.read", group: "Academics" },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck, permission: "attendance.read", group: "Academics" },
  { href: "/assignments", label: "Assignments", icon: FileText, permission: "assignment.read", group: "Academics", module: "assignments" },
  { href: "/exams", label: "Exams", icon: GraduationCap, permission: "exam.result.read", group: "Academics", module: "exams" },
  // T-020: owner/principal/exam_controller only (07 §2.2 exam.recheck.review
  // excludes admin, unlike exam.result.read above).
  { href: "/exams/rechecks", label: "Rechecks", icon: ClipboardList, permission: "exam.recheck.review", group: "Academics", module: "exams" },
  { href: "/lesson-plans", label: "Lesson plans", icon: NotebookText, permission: "diary.write", group: "Academics", module: "lesson_plans" },
  { href: "/question-bank", label: "Question bank", icon: ListChecks, permission: "question.manage", group: "Academics", module: "question_bank" },
  { href: "/timetable", label: "Timetable", icon: CalendarDays, permission: "timetable.read", group: "Academics", module: "timetable" },
  { href: "/admissions", label: "Admissions", icon: ClipboardList, permission: "admissions.enquiry.read", group: "Operations", module: "admissions" },
  { href: "/finance", label: "Finance", icon: Banknote, permission: "finance.read", group: "Operations" },
  // The page requires finance.structure.manage (owner/principal/admin), not finance.read.
  { href: "/finance/ledger", label: "Ledger", icon: BookText, permission: "finance.structure.manage", group: "Operations" },
  { href: "/website", label: "Website", icon: Globe, permission: "website.edit", group: "Operations", module: "website" },
  // T-0NN: teacher-only tool-calling agent (D28); other `ai.generate` roles
  // see this link too (the page itself shows "not available yet" for them).
  { href: "/ai", label: "AI Assistant", icon: Bot, permission: "ai.generate", group: "Communication", module: "ai_teacher" },
  { href: "/notifications", label: "Notifications", icon: Bell, permission: "notification.read", group: "Communication" },
  { href: "/messages", label: "Messages", icon: MessagesSquare, permission: "message.read", group: "Communication", module: "messaging" },
  { href: "/diary", label: "Class diary", icon: NotebookPen, permission: "diary.write", group: "Communication", module: "diary" },
  // One page, two jobs: admins schedule meeting days, teachers open their slots (deduped by href below).
  { href: "/ptm", label: "Parent meetings", icon: CalendarClock, permission: "ptm.manage", group: "Communication", module: "ptm" },
  { href: "/ptm", label: "Parent meetings", icon: CalendarClock, permission: "ptm.slot.manage", group: "Communication", module: "ptm" },
  { href: "/ai/usage", label: "AI usage", icon: BarChart3, permission: "ai.usage.read", group: "Admin" },
  { href: "/jobs", label: "Jobs", icon: Briefcase, permission: "job.manage", group: "Admin" },
  { href: "/settings/modules", label: "Modules", icon: Puzzle, permission: "institution.settings.manage", group: "Admin" },
  { href: "/settings/ai", label: "AI roles", icon: Bot, permission: "institution.settings.manage", group: "Admin" },
  { href: "/fabric/learning", label: "Learning", icon: Book, permission: "dashboard.view", group: "Fabric" },
  { href: "/fabric/students", label: "Student success", icon: Target, permission: "mastery.review", group: "Fabric", module: "mastery" },
  { href: "/fabric/operations", label: "Operations", icon: Cog, permission: "dashboard.view", group: "Fabric" },
  { href: "/fabric/finance-intel", label: "Finance intel", icon: TrendingUp, permission: "finance.read", group: "Fabric", module: "forecasts" },
  { href: "/fabric/insights", label: "Insights", icon: Lightbulb, permission: "insight.read", group: "Fabric", module: "insights" },
  { href: "/fabric/simulator", label: "Simulator", icon: Zap, permission: "scenario.manage", group: "Fabric" },
  { href: "/fabric/twin", label: "Digital twin", icon: Cpu, permission: "dashboard.view", group: "Fabric" },
  { href: "/fabric/agents", label: "AI workforce", icon: Sparkles, permission: "agent.run", group: "Fabric", module: "agents" },
  { href: "/fabric/marketplace", label: "Marketplace", icon: Store, permission: "dashboard.view", group: "Fabric" },
  { href: "/fabric/studio", label: "Custom Studio", icon: Palette, permission: "studio.request", group: "Fabric" },
  { href: "/fabric/data", label: "Data & integrations", icon: Database, permission: "dashboard.view", group: "Fabric" },
  { href: "/fabric/trust", label: "Trust & governance", icon: Shield, permission: "dashboard.view", group: "Fabric" },
] as const;

// Portal users (the same exam.recheck.request marker as the Portal link) hold
// read permissions for their own child's data, but the staff module pages
// aren't built for them. Their sidebar is the portal's own page set (formerly
// the PortalNav tab strip), same visibility rules the tabs had. UI only; RLS
// still governs data. Module keys mirror what each portal page enforces.
const P = "exam.recheck.request" as const;
const portal = (href: string, label: string, icon: LucideIcon, group: NavGroup, module?: ModuleKey): NavItem => ({
  href: `/portal${href}`,
  label,
  icon,
  permission: P,
  group,
  module,
});

export const GUARDIAN_NAV: readonly NavItem[] = [
  portal("", "Overview", UserCircle, "My child"),
  portal("/attendance", "Attendance", CalendarCheck, "My child", "attendance"),
  portal("/results", "Results", GraduationCap, "My child", "exams"),
  portal("/assignments", "Assignments", FileText, "My child", "assignments"),
  portal("/updates", "Updates", Megaphone, "My child"),
  portal("/fees", "Fees", Banknote, "My child", "fees"),
  portal("/messages", "Messages", MessagesSquare, "Communication", "messaging"),
  portal("/meetings", "Meetings", CalendarClock, "Communication", "ptm"),
  portal("/assistant", "Ask AI", Bot, "Communication"),
  portal("/leave", "Leave", CalendarOff, "Communication"),
  portal("/surveys", "Surveys", ClipboardList, "Communication"),
  portal("/notifications", "Notifications", Bell, "Communication"),
];

export const STUDENT_NAV: readonly NavItem[] = [
  portal("", "Overview", UserCircle, "Overview"),
  portal("/subjects", "Subjects", Book, "Learning"),
  { ...portal("/study", "Study", BookOpen, "Learning"), permission: "ai.study" },
  { ...portal("/practice", "Practice", Target, "Learning", "practice"), permission: "ai.study" },
  portal("/assignments", "Assignments", FileText, "Academic", "assignments"),
  portal("/results", "Results", GraduationCap, "Academic", "exams"),
  portal("/attendance", "Attendance", CalendarCheck, "Academic", "attendance"),
  portal("/fees", "Fees", Banknote, "Academic", "fees"),
  portal("/notifications", "Notifications", Bell, "Updates"),
];

/**
 * `role` picks the portal list for student/guardian members. Omitted, it is
 * inferred from `assignment.submit`, which only students hold.
 */
export function navItemsFor(
  permissions: ReadonlySet<Permission>,
  settings?: Record<string, unknown>,
  _isDemo = false,
  role?: Role,
): NavItem[] {
  const isPortalUser = permissions.has(P);
  const hasDashboard = permissions.has("dashboard.view");
  const portalRole = role ?? (permissions.has("assignment.submit") ? "student" : "guardian");
  const source = isPortalUser ? (portalRole === "student" ? STUDENT_NAV : GUARDIAN_NAV) : NAV_ITEMS;
  const seen = new Set<string>();
  return source.filter((item) => {
    if (seen.has(item.href)) return false;
    // Portal Overview/Notifications are gated by the marker only; Study/Practice also need ai.study.
    if (!permissions.has(item.permission)) return false;
    if (item.href === "/today" && hasDashboard) return false;
    if (item.demoOnly) return false;
    // Fabric pages themselves require dashboard.view; hide the link from roles that would get a 403.
    if (item.group === "Fabric" && !hasDashboard) return false;
    if (item.module && settings && !isModuleEnabled({ institution: { settings } }, item.module)) return false;
    seen.add(item.href);
    return true;
  });
}

// Landing page for `/[institution]`: staff without `dashboard.view` (teacher)
// must never be sent to `/portal`, which serves guardians/students only.
export function homePathFor(permissions: ReadonlySet<Permission>, settings?: Record<string, unknown>): string {
  if (permissions.has("dashboard.view")) return "/dashboard";
  if (permissions.has("exam.recheck.request")) return "/portal";
  if (permissions.has("attendance.mark")) return "/today";
  return navItemsFor(permissions, settings)[0]?.href ?? "/notifications";
}
