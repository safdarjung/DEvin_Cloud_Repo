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
  UserCircle,
  Users,
} from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
}

// Lead-owned (09 §4): lanes add one line each as their module lands. Filtered
// by the signed-in member's permissions, not by role name directly.
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
  { href: "/students", label: "Students", icon: Users, permission: "student.read" },
  { href: "/admissions", label: "Admissions", icon: ClipboardList, permission: "admissions.enquiry.read" },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck, permission: "attendance.read" },
  { href: "/assignments", label: "Assignments", icon: FileText, permission: "assignment.read" },
  { href: "/exams", label: "Exams", icon: GraduationCap, permission: "exam.result.read" },
  // T-020: owner/principal/exam_controller only (07 §2.2 exam.recheck.review
  // excludes admin, unlike exam.result.read above).
  { href: "/exams/rechecks", label: "Rechecks", icon: ClipboardList, permission: "exam.recheck.review" },
  { href: "/finance", label: "Finance", icon: Banknote, permission: "finance.read" },
  { href: "/website", label: "Website", icon: Globe, permission: "website.edit" },
  // T-0NN: teacher-only tool-calling agent (D28); other `ai.generate` roles
  // see this link too (the page itself shows "not available yet" for them).
  { href: "/ai", label: "AI Assistant", icon: Bot, permission: "ai.generate" },
  { href: "/ai/usage", label: "AI usage", icon: BarChart3, permission: "ai.usage.read" },
  { href: "/notifications", label: "Notifications", icon: Bell, permission: "notification.read" },
  { href: "/jobs", label: "Jobs", icon: Briefcase, permission: "job.manage" },
  // No dedicated "portal.view" permission exists (07 §2.2); exam.recheck.request
  // is the only row granted to exactly {student, guardian} and no staff role,
  // which is exactly who the portal link is for.
  { href: "/portal", label: "Portal", icon: UserCircle, permission: "exam.recheck.request" },
] as const;

export function navItemsFor(permissions: ReadonlySet<Permission>): NavItem[] {
  return NAV_ITEMS.filter((item) => permissions.has(item.permission));
}

// Landing page for `/[institution]`: staff without `dashboard.view` (teacher)
// must never be sent to `/portal`, which serves guardians/students only.
export function homePathFor(permissions: ReadonlySet<Permission>): string {
  if (permissions.has("dashboard.view")) return "/dashboard";
  if (permissions.has("exam.recheck.request")) return "/portal";
  if (permissions.has("attendance.mark")) return "/attendance";
  return navItemsFor(permissions)[0]?.href ?? "/notifications";
}
