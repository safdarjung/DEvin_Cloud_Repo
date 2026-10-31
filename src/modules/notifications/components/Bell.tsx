import Link from "next/link";
import { Bell as BellIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// T-038 acceptance criterion 2 — header slot: shows the unread count,
// computed server-side (layout.tsx) from the signed-in user's own
// `notifications` rows. Opening `/notifications` is what marks rows read
// (Inbox.tsx's mark-read buttons); this component itself never fetches.
export function Bell({ href, unreadCount }: { href: string; unreadCount: number }) {
  return (
    <Link href={href} className="relative flex min-h-10 min-w-10 items-center justify-center rounded-md transition-colors duration-(--duration-fast) ease-out outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label="Notifications">
      <BellIcon className="size-5" />
      {unreadCount > 0 && (
        <Badge variant="destructive" className="absolute -right-1 -top-1 h-5 min-w-5 justify-center px-1 text-xs">
          {unreadCount > 99 ? "99+" : unreadCount}
        </Badge>
      )}
    </Link>
  );
}
