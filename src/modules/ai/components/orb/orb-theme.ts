// Colour for the App Orb only. The app chrome stays monochrome (globals.css);
// the orb core carries a per-role accent.
import type { Role } from "@/lib/auth/permissions";
import type { OrbMode } from "@/modules/ai/tasks/types";

/** [deep, bright] gradient stops for the core. */
export const ROLE_ACCENTS: Record<Role, readonly [string, string]> = {
  owner: ["#4338CA", "#C084FC"],
  principal: ["#4338CA", "#C084FC"],
  admin: ["#1D4ED8", "#38BDF8"],
  admissions: ["#0E7490", "#5EEAD4"],
  accountant: ["#047857", "#A3E635"],
  exam_controller: ["#6D28D9", "#F472B6"],
  teacher: ["#0F766E", "#38BDF8"],
  student: ["#C2410C", "#FBBF24"],
  guardian: ["#BE123C", "#FB923C"],
};

/** Error tint for the core (matches --destructive in spirit; shaders need a literal). */
export const ORB_ERROR = "#E5484D";

/** The active mode tints the core; Ask keeps the role's own accent. */
const MODE_ACCENTS: Record<Exclude<OrbMode, "ask">, readonly [string, string]> = {
  do: ["#0369A1", "#22D3EE"],
  create: ["#9D174D", "#F9A8D4"],
  teach: ["#115E59", "#6EE7B7"],
  learn: ["#B45309", "#FCD34D"],
  manage: ["#334155", "#A5B4FC"],
};

/** The role always keeps the deep stop (its ring and the net's base colour); a mode other than Ask brings its bright stop. */
export const orbAccent = (role: Role, mode: OrbMode): readonly [string, string] =>
  mode === "ask" ? ROLE_ACCENTS[role] : [ROLE_ACCENTS[role][0], MODE_ACCENTS[mode][1]];

/** Each role's own name and line over the orb, and the mode it opens on (when the person has features there). */
export const ROLE_HOME: Record<Role, { title: string; greeting: string; mode: OrbMode }> = {
  owner: { title: "Owner", greeting: "Your school at a glance: people, money and approvals", mode: "do" },
  principal: { title: "Principal", greeting: "Your school at a glance: people, money and approvals", mode: "do" },
  admin: { title: "School admin", greeting: "Set-up, records and the day's paperwork", mode: "manage" },
  admissions: { title: "Admissions", greeting: "Enquiries, applications and new families", mode: "do" },
  accountant: { title: "Accounts", greeting: "Fees, payments and the school's books", mode: "do" },
  exam_controller: { title: "Exam cell", greeting: "Exams, marks and results", mode: "do" },
  // Ask, not Teach: Teach holds only a few class tasks, so the first view looked empty (owner, 2026-11-12).
  teacher: { title: "Teacher", greeting: "Your classes, attendance and lesson tools", mode: "ask" },
  student: { title: "Student", greeting: "Your study, homework and timetable", mode: "learn" },
  guardian: { title: "Parent", greeting: "Your child's fees, attendance and progress", mode: "ask" },
};
