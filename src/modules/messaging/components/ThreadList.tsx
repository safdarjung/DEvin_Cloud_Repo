import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { formatIst } from "@/modules/messaging/format";
import type { ThreadSummary } from "@/modules/messaging/queries";

/** `who` picks the counterpart label; `query` is appended to each thread link (e.g. ?student=). */
export function ThreadList({
  threads,
  basePath,
  query = "",
  who,
  emptyAction,
}: {
  threads: ThreadSummary[];
  basePath: string;
  query?: string;
  who: (t: ThreadSummary) => string;
  emptyAction?: ReactNode;
}) {
  if (threads.length === 0) {
    return <EmptyState title="No messages yet" description="Conversations you start or receive appear here." action={emptyAction} />;
  }
  return (
    <ul className="divide-y rounded-xl border">
      {threads.map((t) => (
        <li key={t.id}>
          <Link
            href={`${basePath}/${t.id}${query}`}
            className="flex min-h-14 items-start justify-between gap-3 px-4 py-3 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{t.subject}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {who(t)} · {t.studentName}
              </span>
              {t.lastMessagePreview && <span className="mt-1 block truncate text-sm text-muted-foreground">{t.lastMessagePreview}</span>}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-xs tabular-nums text-muted-foreground">{formatIst(t.lastMessageAt)}</span>
              {t.unreadCount > 0 && <Badge>{t.unreadCount} unread</Badge>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
