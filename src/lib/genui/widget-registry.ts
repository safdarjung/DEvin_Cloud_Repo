// F-BE-03 — the one map from a canvas `widget` node's `name` to the existing
// dashboard widget, and from a spec icon name to a lucide icon. Closed sets:
// a name the schema doesn't know never reaches here (schemas.ts rejects it).
import { createElement } from "react";
import {
  Bell, BookOpen, Bus, Calendar, ChartColumn, CircleCheck, ClipboardCheck, Clock, FileText,
  GraduationCap, IndianRupee, Megaphone, MessageSquare, Plus, Receipt, School, Settings,
  Sparkles, TrendingDown, TrendingUp, TriangleAlert, User, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { ActivityTimeline } from "@/components/widgets/activity-timeline";
import { AIInsightCard } from "@/components/widgets/ai-insight-card";
import { ApprovalsWidget } from "@/components/widgets/approvals-widget";
import { KpiTile } from "@/components/widgets/kpi-widget";
import { ListWidget } from "@/components/widgets/list-widget";
import { QuickActions } from "@/components/widgets/quick-actions";
import { StaffAvailabilityWidget } from "@/components/widgets/staff-availability-widget";
import { TimetableWidget } from "@/components/widgets/timetable-widget";
import { TrendWidget } from "@/components/widgets/trend-widget";
import type { CanvasIconName, WidgetNode } from "@/modules/fabric/spec/schemas";

export const WIDGETS = {
  kpi: KpiTile,
  trend: TrendWidget,
  list: ListWidget,
  timeline: ActivityTimeline,
  approvals: ApprovalsWidget,
  staffAvailability: StaffAvailabilityWidget,
  timetable: TimetableWidget,
  aiInsight: AIInsightCard,
  quickActions: QuickActions,
} satisfies Record<WidgetNode["name"], unknown>;

const ICONS: Record<CanvasIconName, LucideIcon> = {
  users: Users,
  user: User,
  "graduation-cap": GraduationCap,
  "book-open": BookOpen,
  calendar: Calendar,
  clock: Clock,
  wallet: Wallet,
  "indian-rupee": IndianRupee,
  receipt: Receipt,
  "clipboard-check": ClipboardCheck,
  bell: Bell,
  "triangle-alert": TriangleAlert,
  "circle-check": CircleCheck,
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  "file-text": FileText,
  settings: Settings,
  sparkles: Sparkles,
  school: School,
  bus: Bus,
  megaphone: Megaphone,
  "message-square": MessageSquare,
  "chart-column": ChartColumn,
  plus: Plus,
};

export function canvasIcon(name: CanvasIconName | undefined) {
  return name ? createElement(ICONS[name], { className: "size-4", "aria-hidden": true }) : undefined;
}
