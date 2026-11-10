import type { TourFeature } from "../roles.ts";

export const SCENE_KEYS = [
  "dashboard",
  "portal",
  "briefing",
  "forecast",
  "funnel",
  "kanban",
  "reports",
  "insights",
  "roster",
  "receipt",
  "website",
  "messages",
  "audit",
  "register",
  "calendar",
  "alert",
  "notifications",
  "diary",
  "assignments",
  "marks",
  "quiz",
  "meetings",
  "generic",
] as const;
export type SceneKey = (typeof SCENE_KEYS)[number];

/** Title keywords win over the icon, so two features sharing an icon can get different scenes. */
const BY_KEYWORD: readonly (readonly [RegExp, SceneKey])[] = [
  [/funnel/, "funnel"],
  [/pipeline/, "kanban"],
  [/report card|result|marks/, "marks"],
  [/report/, "reports"],
  [/alert/, "alert"],
  [/my attendance/, "calendar"],
  [/quiz/, "quiz"],
  [/forecast/, "forecast"],
  [/briefing/, "briefing"],
  [/meeting/, "meetings"],
  [/portal/, "portal"],
];

const BY_ICON: Readonly<Record<string, SceneKey>> = {
  LayoutDashboard: "dashboard",
  Sun: "briefing",
  TrendingUp: "forecast",
  ClipboardList: "kanban",
  Bell: "notifications",
  Sparkles: "insights",
  Users: "roster",
  Banknote: "receipt",
  Globe: "website",
  Megaphone: "messages",
  Shield: "audit",
  CalendarCheck: "register",
  CalendarClock: "meetings",
  NotebookPen: "diary",
  FileText: "assignments",
  GraduationCap: "marks",
  Bot: "quiz",
  BookOpen: "portal",
};

export function sceneKeyFor(feature: Pick<TourFeature, "title" | "icon">): SceneKey {
  const title = feature.title.toLowerCase();
  return BY_KEYWORD.find(([re]) => re.test(title))?.[1] ?? BY_ICON[feature.icon] ?? "generic";
}
