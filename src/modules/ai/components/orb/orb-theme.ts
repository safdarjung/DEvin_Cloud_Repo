// Colour for the App Orb only. The app chrome stays monochrome (globals.css);
// the orb's core carries a per-role accent and tiles a hint of their nav group.
import type { Role } from "@/lib/auth/permissions";

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

const GROUP_HUES: Record<string, string> = {
  Overview: "#6366F1",
  Academics: "#0EA5E9",
  Academic: "#0EA5E9",
  Learning: "#14B8A6",
  Operations: "#F59E0B",
  Communication: "#10B981",
  Updates: "#10B981",
  "My child": "#EC4899",
  Admin: "#71717A",
  Fabric: "#A855F7",
  Personal: "#EC4899",
};

export const groupHue = (group: string): string => GROUP_HUES[group] ?? "#71717A";

/** Error tint for the core (matches --destructive in spirit; shaders need a literal). */
export const ORB_ERROR = "#E5484D";
