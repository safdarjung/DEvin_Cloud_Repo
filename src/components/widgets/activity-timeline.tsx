import { EmptyState } from "@/components/states";
import { Widget, type WidgetProps } from "@/components/widgets/widget";

export interface TimelineEvent {
  id: string;
  title: string;
  /** ISO timestamp. */
  time: string;
  meta?: string;
}

const TZ = "Asia/Kolkata";
const short = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: TZ });

/** "just now" / "5 min ago" / "3 h ago" within a day, else "31 Oct, 2:30 pm" (IST). */
export function formatEventTime(iso: string, now: Date): string {
  const t = new Date(iso);
  const mins = Math.round((now.getTime() - t.getTime()) / 60000);
  if (mins < 0 || mins >= 24 * 60) return short.format(t);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} h ago`;
}

export function ActivityTimeline({
  events,
  now,
  ...frame
}: Omit<WidgetProps, "children" | "empty" | "isEmpty"> & { events: TimelineEvent[]; now: Date }) {
  return (
    <Widget {...frame} isEmpty={events.length === 0} empty={<EmptyState title="No recent activity" />}>
      <ol className="relative ml-1.5 space-y-4 border-l-2 border-border pl-5">
        {events.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute top-1 -left-[27px] size-2.5 rounded-full border-2 border-ring bg-card" aria-hidden />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{e.title}</p>
                {e.meta && <p className="text-xs text-muted-foreground italic">{e.meta}</p>}
              </div>
              <time dateTime={e.time} className="shrink-0 text-xs text-muted-foreground">
                {formatEventTime(e.time, now)}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </Widget>
  );
}
