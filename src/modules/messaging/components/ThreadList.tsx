import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { formatIst } from "@/modules/messaging/format";
import type { ThreadSummary } from "@/modules/messaging/queries";
import { AnimatedList } from "@/components/widgets/viz";

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}

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
    <AnimatedList className="space-y-0 divide-y divide-border overflow-hidden rounded-md border border-border bg-card" ariaLabel="Conversations">
      {threads.map((t) => {
        const unread = t.unreadCount > 0;
        const label = who(t);
        return (
            <Link
              key={t.id}
              href={`${basePath}/${t.id}${query}`}
              className="flex min-h-14 items-start gap-3 px-4 py-3 transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${unread ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
              >
                {initials(label)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={`block truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>{t.subject}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatIst(t.lastMessageAt)}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {label} · {t.studentName}
                </span>
                <span className="mt-1 flex items-center justify-between gap-3">
                  <span className="block min-w-0 truncate text-sm text-muted-foreground">{t.lastMessagePreview}</span>
                  {unread && <Badge className="shrink-0">{t.unreadCount} unread</Badge>}
                </span>
              </span>
            </Link>
        );
      })}
    </AnimatedList>
  );
}
