import type { Role } from "@/lib/auth/permissions";

// Steps for the in-app guided tour (src/components/tenant/app-tour.tsx): one per sidebar tab, in sidebar order.
type Copy = { text: string; teacher?: string; student?: string; guardian?: string };

export interface TourStep {
  href: string;
  title: string;
  text: string;
  group: string;
  /** A question about this page to send to the Orb chat. */
  ask?: string;
  /** Practice scenarios this member can make for this tab (demo school only). */
  practice?: { key: string; label: string; detail: string }[];
}

export function buildTourSteps(
  items: readonly { href: string; label: string; group: string }[],
  base: string,
  role: Role,
  copy: Readonly<Record<string, Copy>>,
): TourStep[] {
  return items.map(({ href, label, group }) => {
    const entry = copy[href.slice(base.length) || "/"];
    const override = role === "teacher" || role === "student" || role === "guardian" ? entry?.[role] : undefined;
    return { href, title: label, text: override ?? entry?.text ?? `Open ${label} to see what is here.`, group };
  });
}

/** Window event the account menu fires to (re)start the tour. */
export const TOUR_START_EVENT = "fabric-tour:start";

export const tourStorageKey =(userId: string, institutionId: string) => `fabric-tour:v1:${userId}:${institutionId}`;
