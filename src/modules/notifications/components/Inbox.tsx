import { Badge } from "@/components/ui/badge";
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
    return <p className="text-muted-foreground text-sm">No notifications.</p>;
  }

  return (
    <ul className="divide-y">
      {notifications.map((n) => (
        <li key={n.id} className="flex items-start justify-between gap-4 py-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{n.title}</span>
              {!n.readAt && <Badge variant="default">New</Badge>}
            </div>
            <p className="text-muted-foreground text-sm">{n.body}</p>
            <p className="text-muted-foreground text-xs">{new Date(n.createdAt).toLocaleString()}</p>
          </div>
          {!n.readAt && <MarkReadButton institutionSlug={institutionSlug} notificationId={n.id} />}
        </li>
      ))}
    </ul>
  );
}
