import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { AnimatedList } from "@/components/widgets/viz";
import type { NotificationSummary } from "@/modules/notifications/queries";
import { MarkReadButton } from "./MarkReadButton";

// Acceptance criterion 2 — unread notifications are visually marked; each
// row's own "Mark read" button is the only write path (notification.read).
export function Inbox({
  institutionSlug,
  notifications,
}: {
  institutionSlug: string;
  notifications: NotificationSummary[];
}) {
  if (notifications.length === 0) {
    return <EmptyState title="No notifications" description="Messages addressed to you will appear here." />;
  }

  return (
    <AnimatedList ariaLabel="Notifications" className="space-y-0 divide-y divide-border">
      {notifications.map((n) => (
        <div key={n.id} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{n.title}</span>
              {!n.readAt && <Badge variant="default">New</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{n.body}</p>
            <p className="text-xs text-muted-foreground tabular-nums">{new Date(n.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
          </div>
          {!n.readAt && <MarkReadButton institutionSlug={institutionSlug} notificationId={n.id} />}
        </div>
      ))}
    </AnimatedList>
  );
}
