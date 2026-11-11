// One registry of home-dashboard widgets. Which roles see which widget stays
// decided in the dashboard page (permissions/modules/data); a saved layout can
// only hide or reorder what the page already offers the user. Plain module (no
// server-only, relative imports) so schemas.ts and unit tests can import it.
export const DASHBOARD_WIDGETS = {
  "kpi-strip": "Key figures",
  "attendance-trend": "Attendance performance",
  "today-glance": "Today at a glance",
  "fees-by-class": "Fees by class",
  "approvals-staff": "Approvals and staff today",
  "section-attendance": "Section attendance",
  upcoming: "Upcoming events and exams",
  "recent-activity": "Recent activity",
  "repeated-absentees": "Repeated absentees",
  "outstanding-ageing": "Outstanding by age",
  "ask-data": "Ask the data",
  "admissions-funnel": "Admissions funnel",
  "fee-collection": "Fee collection this term",
  "exam-grades": "Exam grade distribution",
  "ai-briefing": "AI daily briefing",
  "more-cards": "More from your school",
  "enquiries-trend": "Enquiries per week",
  "enquiry-sources": "Where enquiries come from",
  "newest-enquiries": "Newest enquiries",
  insights: "Insights",
  "top-defaulters": "Top defaulters",
  "exam-pipeline": "Exam pipeline",
  rechecks: "Recheck requests",
  "exams-list": "Exams",
  "website-events": "Upcoming public events",
  "website-notices": "Latest notices",
} as const;

export type DashboardWidgetId = keyof typeof DASHBOARD_WIDGETS;
export const DASHBOARD_WIDGET_IDS = Object.keys(DASHBOARD_WIDGETS) as [DashboardWidgetId, ...DashboardWidgetId[]];

// Cards inside the "more-cards" widget (CommandGrid). Namespaced so they cannot
// collide with widget ids (e.g. "insights"); stored in the same layout row.
export const MORE_CARD_IDS = ["more:priorities", "more:risks", "more:insights", "more:forecasts", "more:grades", "more:assistant"] as const;
export const isMoreCardId = (id: string): boolean => id.startsWith("more:");

export type DashboardLayout = { hidden: string[]; order: string[] };

/**
 * Ordered visible widget ids. `availableIds` is the page's default order of
 * widgets this user may see; unknown saved ids are dropped, saved order wins,
 * widgets the layout has never seen are appended in default order.
 */
export function applyLayout(availableIds: readonly string[], layout: DashboardLayout | null | undefined): string[] {
  const available = new Set(availableIds);
  const hidden = new Set(layout?.hidden ?? []);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of [...(layout?.order ?? []), ...availableIds]) {
    if (!available.has(id) || seen.has(id)) continue;
    seen.add(id);
    if (!hidden.has(id)) ordered.push(id);
  }
  return ordered;
}
