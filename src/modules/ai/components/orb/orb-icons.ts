// Icon components are not serialisable across the server -> client boundary,
// so the server page sends a string key and the client maps it back here.
import type { LucideIcon } from "lucide-react";
import {
  Banknote, BarChart3, Bell, Book, BookOpen, BookText, Bot, Briefcase, CalendarCheck, CalendarClock, CalendarDays,
  CalendarOff, ClipboardList, Cog, Cpu, Database, FileText, Globe, GraduationCap, LayoutDashboard, Lightbulb,
  ListChecks, Megaphone, MessageSquare, MessagesSquare, NotebookPen, NotebookText, Orbit, Palette, Puzzle, Shield,
  Sparkles, Store, Sun, Target, TrendingUp, UserCircle, Users, Zap,
} from "lucide-react";

export const ORB_ICONS = {
  Banknote, BarChart3, Bell, Book, BookOpen, BookText, Bot, Briefcase, CalendarCheck, CalendarClock, CalendarDays,
  CalendarOff, ClipboardList, Cog, Cpu, Database, FileText, Globe, GraduationCap, LayoutDashboard, Lightbulb,
  ListChecks, Megaphone, MessageSquare, MessagesSquare, NotebookPen, NotebookText, Orbit, Palette, Puzzle, Shield,
  Sparkles, Store, Sun, Target, TrendingUp, UserCircle, Users, Zap,
} satisfies Record<string, LucideIcon>;

export type OrbIconKey = keyof typeof ORB_ICONS;

/** Server side: component -> key. Unknown icons fall back to a generic one. */
export function orbIconKey(icon: LucideIcon): OrbIconKey {
  return (Object.keys(ORB_ICONS) as OrbIconKey[]).find((k) => ORB_ICONS[k] === icon) ?? "Orbit";
}
