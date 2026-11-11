// Colour for the App Orb only. The app chrome stays monochrome (globals.css);
// the orb core carries a per-role accent.
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

/** Error tint for the core (matches --destructive in spirit; shaders need a literal). */
export const ORB_ERROR = "#E5484D";
