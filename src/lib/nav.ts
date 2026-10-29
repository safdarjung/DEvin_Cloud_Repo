import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Briefcase,
  CalendarCheck,
  ClipboardList,
  Globe,
  GraduationCap,
  LayoutDashboard,
  Settings,
  Sparkles,
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
  { href: "/academics", label: "Academics", icon: BookOpen, permission: "academics.read" },
  { href: "/exams", label: "Exams", icon: GraduationCap, permission: "exam.result.read" },
  { href: "/finance", label: "Finance", icon: Banknote, permission: "finance.read" },
  { href: "/website", label: "Website", icon: Globe, permission: "website.edit" },
  { href: "/ai", label: "AI", icon: Sparkles, permission: "ai.generate" },
  { href: "/ai/usage", label: "AI usage", icon: BarChart3, permission: "ai.usage.read" },
  { href: "/notifications", label: "Notifications", icon: Bell, permission: "notification.read" },
  { href: "/jobs", label: "Jobs", icon: Briefcase, permission: "job.manage" },
  { href: "/settings", label: "Settings", icon: Settings, permission: "institution.settings.manage" },
  // No dedicated "portal.view" permission exists (07 §2.2); exam.recheck.request
  // is the only row granted to exactly {student, guardian} and no staff role,
  // which is exactly who the portal link is for.
  { href: "/portal", label: "Portal", icon: UserCircle, permission: "exam.recheck.request" },
] as const;

export function navItemsFor(permissions: ReadonlySet<Permission>): NavItem[] {
  return NAV_ITEMS.filter((item) => permissions.has(item.permission));
}
