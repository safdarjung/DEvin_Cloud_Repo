// Closed id lists shared by the settings schema (plain node via the seed scripts,
// so no runtime imports) and the control centre. Record<..., true> makes a new
// OrbGroupId / OrbMode a compile error here until it is listed.
import type { OrbGroupId } from "../../ai/components/orb/orb-groups";
import type { OrbMode } from "../../ai/tasks/types";

const GROUP_LABELS: Record<OrbGroupId, string> = {
  attendance: "Attendance", exams: "Exams", teaching: "Teaching", study: "Study", finance: "Finance", admissions: "Admissions",
  timetable: "Timetable", people: "People", insights: "Insights", calendar: "Calendar & notices", clubs: "Clubs & activities",
  operations: "School operations", website: "Website", more: "More",
};

const MODE_LABELS: Record<OrbMode, string> = { ask: "Ask", do: "Do", create: "Create", teach: "Teach", learn: "Learn", manage: "Manage" };

export const ORB_GROUP_IDS = Object.keys(GROUP_LABELS) as [OrbGroupId, ...OrbGroupId[]];
export const ORB_MODES = Object.keys(MODE_LABELS) as [OrbMode, ...OrbMode[]];
export const groupLabel = (id: OrbGroupId): string => GROUP_LABELS[id];
export const modeLabel = (m: OrbMode): string => MODE_LABELS[m];

/** Registered action names the orb may carry overrides for. */
export const TASK_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_.]{1,80}$/;
/** Size cap on one role's task overrides (the catalog is a few hundred rows). */
export const MAX_TASK_OVERRIDES = 600;
