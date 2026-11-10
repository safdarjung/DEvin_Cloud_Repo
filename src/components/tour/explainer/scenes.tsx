import type { ComponentType } from "react";
import type { SceneKey } from "./scene-map";
import { Calendar, Dashboard, Forecast, Funnel, Generic, Marks, Portal, type SceneProps } from "./scenes-data";
import { Assignments, Kanban, Meetings, Receipt, Register, Website } from "./scenes-flow";
import { Alert, Audit, Briefing, Diary, Insights, Messages, Notifications, Quiz, Reports, Roster } from "./scenes-talk";

export const SCENES: Record<SceneKey, ComponentType<SceneProps>> = {
  dashboard: Dashboard,
  portal: Portal,
  briefing: Briefing,
  forecast: Forecast,
  funnel: Funnel,
  kanban: Kanban,
  reports: Reports,
  insights: Insights,
  roster: Roster,
  receipt: Receipt,
  website: Website,
  messages: Messages,
  audit: Audit,
  register: Register,
  calendar: Calendar,
  alert: Alert,
  notifications: Notifications,
  diary: Diary,
  assignments: Assignments,
  marks: Marks,
  quiz: Quiz,
  meetings: Meetings,
  generic: Generic,
};
