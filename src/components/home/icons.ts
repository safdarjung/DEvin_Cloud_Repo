import {
  Banknote,
  Bell,
  BookOpen,
  Bot,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  FileText,
  Globe,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  NotebookPen,
  Shield,
  Sparkles,
  Sun,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

// The icon names used by TOUR_ROLES and STORIES, imported one by one. The tour's `FeatureIcon` resolves any
// name from the whole lucide registry, which is fine inside its lazy film chunk but too heavy for the landing page.
const ICONS: Readonly<Record<string, LucideIcon>> = {
  Banknote,
  Bell,
  BookOpen,
  Bot,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  FileText,
  Globe,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  NotebookPen,
  Shield,
  Sparkles,
  Sun,
  TrendingUp,
  Users,
};

export const homeIcon = (name: string): LucideIcon => ICONS[name] ?? Sparkles;
