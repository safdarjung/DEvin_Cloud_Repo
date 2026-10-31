import type { DashboardDTO } from "@/modules/core/dashboard.queries";
import { RecentActivity } from "./RecentActivity";

/** Renders nothing when the caller lacks `notification.log.read` (entries null). */
export function ActivitySection({ entries }: { entries: DashboardDTO["recentActivity"] }) {
  return entries ? <RecentActivity entries={entries} /> : null;
}
