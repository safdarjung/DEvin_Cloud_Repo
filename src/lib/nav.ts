import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  BarChart3,
  Bell,
  Bot,
  Briefcase,
  CalendarCheck,
  ClipboardList,
  FileText,
  Globe,
  GraduationCap,
  LayoutDashboard,
  Sun,
  UserCircle,
  Users,
} from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";

export type NavGroup = "Overview" | "Academics" | "Operations" | "Communication" | "Admin";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  group: NavGroup;
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
  { href: "/assignments", label: "Assignments", icon: FileText, permission: "assignment.read", group: "Academics" },
  { href: "/exams", label: "Exams", icon: GraduationCap, permission: "exam.result.read", group: "Academics" },
  // T-020: owner/principal/exam_controller only (07 §2.2 exam.recheck.review
  // excludes admin, unlike exam.result.read above).
  { href: "/exams/rechecks", label: "Rechecks", icon: ClipboardList, permission: "exam.recheck.review", group: "Academics" },
  { href: "/admissions", label: "Admissions", icon: ClipboardList, permission: "admissions.enquiry.read", group: "Operations" },
  { href: "/finance", label: "Finance", icon: Banknote, permission: "finance.read", group: "Operations" },
  { href: "/website", label: "Website", icon: Globe, permission: "website.edit", group: "Operations" },
  // T-0NN: teacher-only tool-calling agent (D28); other `ai.generate` roles
  // see this link too (the page itself shows "not available yet" for them).
  { href: "/ai", label: "AI Assistant", icon: Bot, permission: "ai.generate", group: "Communication" },
  { href: "/notifications", label: "Notifications", icon: Bell, permission: "notification.read", group: "Communication" },
  { href: "/ai/usage", label: "AI usage", icon: BarChart3, permission: "ai.usage.read", group: "Admin" },
  { href: "/jobs", label: "Jobs", icon: Briefcase, permission: "job.manage", group: "Admin" },
] as const;

// Portal users (the same exam.recheck.request marker as the Portal link) hold
// read permissions for their own child's data, but the staff module pages
// aren't built for them — the portal tabs are. UI only; RLS still governs data.
const PORTAL_NAV_HREFS = new Set(["/portal", "/notifications"]);

export function navItemsFor(permissions: ReadonlySet<Permission>): NavItem[] {
  const isPortalUser = permissions.has("exam.recheck.request");
  const hasDashboard = permissions.has("dashboard.view");
  return NAV_ITEMS.filter(
    (item) =>
      permissions.has(item.permission) &&
      (!isPortalUser || PORTAL_NAV_HREFS.has(item.href)) &&
      (item.href !== "/today" || !hasDashboard),
  );
}

// Landing page for `/[institution]`: staff without `dashboard.view` (teacher)
// must never be sent to `/portal`, which serves guardians/students only.
export function homePathFor(permissions: ReadonlySet<Permission>): string {
  if (permissions.has("dashboard.view")) return "/dashboard";
  if (permissions.has("exam.recheck.request")) return "/portal";
  if (permissions.has("attendance.mark")) return "/today";
  return navItemsFor(permissions)[0]?.href ?? "/notifications";
}
