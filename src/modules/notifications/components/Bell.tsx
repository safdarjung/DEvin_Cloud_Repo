"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell as BellIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { NotificationSummary } from "@/modules/notifications/queries";
import { MarkReadButton } from "./MarkReadButton";

const rtf = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

function timeAgo(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.trunc(seconds / size), unit);
  }
  return "just now";
}

// T-038 acceptance criterion 2 — header slot: unread count and the latest
// notifications, all computed server-side (layout.tsx) from the signed-in
// user's own rows; this component never fetches. The trigger is a real link to
// the notifications page, so it still works without JS.
export function Bell({
  href,
  unreadCount,
  institutionSlug,
  notifications,
}: {
  href: string;
  unreadCount: number;
  institutionSlug: string;
  notifications: NotificationSummary[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Link
          href={href}
          onClick={(e) => e.preventDefault()}
          aria-label="Notifications"
          className="relative flex min-h-10 min-w-10 items-center justify-center rounded-md outline-none transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BellIcon className="size-5" aria-hidden />
          {unreadCount > 0 && (
            <Badge variant="destructive" className="absolute -right-1 -top-1 h-5 min-w-4 justify-center rounded-full bg-[#1ABB9C] px-1.5 text-[10px] text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Link>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          {unreadCount > 0 && <p className="text-xs text-muted-foreground">{unreadCount} unread</p>}
        </div>
        {notifications.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {notifications.map((n) => (
              <li key={n.id} className="flex items-start gap-2 px-3 py-2.5">
                <span
                  aria-hidden
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-primary"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="sr-only">{n.readAt ? "Read" : "Unread"}</p>
                  <p className="truncate text-sm font-medium">{n.title}</p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{n.body}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{timeAgo(n.createdAt)}</p>
                    {!n.readAt && <MarkReadButton institutionSlug={institutionSlug} notificationId={n.id} />}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={href}
          onClick={() => setOpen(false)}
          className="border-t px-3 py-2.5 text-center text-sm font-medium text-primary outline-none transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          View all
        </Link>
      </PopoverContent>
    </Popover>
  );
}
