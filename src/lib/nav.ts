import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  BarChart3,
  Bell,
  Book,
  Bot,
  Briefcase,
  CalendarCheck,
  ClipboardList,
  Cog,
  Cpu,
  Database,
  FileText,
  Globe,
  GraduationCap,
  LayoutDashboard,
  Lightbulb,
  Palette,
  Puzzle,
  Shield,
  Sparkles,
  Store,
  Sun,
  Target,
  TrendingUp,
  User,
  UserCircle,
  Users,
  Zap,
} from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";
import type { ModuleKey } from "@/lib/modules/catalog";
import { isModuleEnabled } from "@/lib/modules/catalog";

export type NavGroup = "Overview" | "Academics" | "Operations" | "Communication" | "Admin" | "Fabric" | "Personal";

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
  { href: "/portal", label: "Portal", icon: UserCircle, permission: "exam.recheck.request", group: "Overview" },
  { href: "/students", label: "Students", icon: Users, permission: "student.read", group: "Academics" },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck, permission: "attendance.read", group: "Academics" },
  { href: "/assignments", label: "Assignments", icon: FileText, permission: "assignment.read", group: "Academics", module: "assignments" },
  { href: "/exams", label: "Exams", icon: GraduationCap, permission: "exam.result.read", group: "Academics", module: "exams" },
  // T-020: owner/principal/exam_controller only (07 §2.2 exam.recheck.review
  // excludes admin, unlike exam.result.read above).
  { href: "/exams/rechecks", label: "Rechecks", icon: ClipboardList, permission: "exam.recheck.review", group: "Academics", module: "exams" },
  { href: "/admissions", label: "Admissions", icon: ClipboardList, permission: "admissions.enquiry.read", group: "Operations", module: "admissions" },
  { href: "/finance", label: "Finance", icon: Banknote, permission: "finance.read", group: "Operations" },
  { href: "/website", label: "Website", icon: Globe, permission: "website.edit", group: "Operations", module: "website" },
  // T-0NN: teacher-only tool-calling agent (D28); other `ai.generate` roles
  // see this link too (the page itself shows "not available yet" for them).
  { href: "/ai", label: "AI Assistant", icon: Bot, permission: "ai.generate", group: "Communication", module: "ai_teacher" },
  { href: "/notifications", label: "Notifications", icon: Bell, permission: "notification.read", group: "Communication" },
  { href: "/ai/usage", label: "AI usage", icon: BarChart3, permission: "ai.usage.read", group: "Admin" },
  { href: "/jobs", label: "Jobs", icon: Briefcase, permission: "job.manage", group: "Admin" },
  { href: "/settings/modules", label: "Modules", icon: Puzzle, permission: "institution.settings.manage", group: "Admin" },
  { href: "/fabric/learning", label: "Learning", icon: Book, permission: "dashboard.view", group: "Fabric" },
  { href: "/fabric/students", label: "Student success", icon: Target, permission: "dashboard.view", group: "Fabric", demoOnly: true },
  { href: "/fabric/operations", label: "Operations", icon: Cog, permission: "dashboard.view", group: "Fabric" },
  { href: "/fabric/finance-intel", label: "Finance intel", icon: TrendingUp, permission: "finance.read", group: "Fabric", module: "forecasts" },
  { href: "/fabric/insights", label: "Insights", icon: Lightbulb, permission: "insight.read", group: "Fabric", module: "insights" },
  { href: "/fabric/simulator", label: "Simulator", icon: Zap, permission: "dashboard.view", group: "Fabric", demoOnly: true },
  { href: "/fabric/twin", label: "Digital twin", icon: Cpu, permission: "dashboard.view", group: "Fabric", demoOnly: true },
  { href: "/fabric/agents", label: "AI workforce", icon: Sparkles, permission: "agent.run", group: "Fabric", module: "agents" },
  { href: "/fabric/marketplace", label: "Marketplace", icon: Store, permission: "dashboard.view", group: "Fabric", demoOnly: true },
  { href: "/fabric/studio", label: "Custom Studio", icon: Palette, permission: "dashboard.view", group: "Fabric", demoOnly: true },
  { href: "/fabric/data", label: "Data & integrations", icon: Database, permission: "dashboard.view", group: "Fabric" },
  { href: "/fabric/trust", label: "Trust & governance", icon: Shield, permission: "dashboard.view", group: "Fabric" },
  { href: "/me", label: "Personal AI", icon: User, permission: "ai.generate", group: "Personal" },
] as const;

// Portal users (the same exam.recheck.request marker as the Portal link) hold
// read permissions for their own child's data, but the staff module pages
// aren't built for them — the portal tabs are. UI only; RLS still governs data.
const PORTAL_NAV_HREFS = new Set(["/portal", "/notifications"]);

export function navItemsFor(permissions: ReadonlySet<Permission>, settings?: Record<string, unknown>, _isDemo = false): NavItem[] {
  const isPortalUser = permissions.has("exam.recheck.request");
  const hasDashboard = permissions.has("dashboard.view");
  return NAV_ITEMS.filter((item) => {
    if (!permissions.has(item.permission)) return false;
    if (isPortalUser && !PORTAL_NAV_HREFS.has(item.href)) return false;
    if (item.href === "/today" && hasDashboard) return false;
    if (item.demoOnly) return false;
    // Fabric pages themselves require dashboard.view; hide the link from roles that would get a 403.
    if (item.group === "Fabric" && !hasDashboard) return false;
    if (item.module && settings && !isModuleEnabled({ institution: { settings } }, item.module)) return false;
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
