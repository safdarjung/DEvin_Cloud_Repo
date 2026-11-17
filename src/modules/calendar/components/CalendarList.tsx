import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { humanize } from "@/lib/format";

const KIND_LABEL: Record<string, string> = { ptm: "Parent-teacher meeting" };
import type { CalendarEventRow } from "@/modules/calendar/queries";

const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const monthFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", month: "long", year: "numeric" });
const at = (iso: string) => new Date(`${iso}T00:00:00+05:30`);

export function dateRange(e: Pick<CalendarEventRow, "startsOn" | "endsOn">): string {
  return e.startsOn === e.endsOn ? dayFmt.format(at(e.startsOn)) : `${dayFmt.format(at(e.startsOn))} – ${dayFmt.format(at(e.endsOn))}`;
}

/** Events grouped by the month they start in (input is already ordered by start date). */
export function CalendarList({ events, actions }: { events: CalendarEventRow[]; actions?: (e: CalendarEventRow) => ReactNode }) {
  const groups = new Map<string, CalendarEventRow[]>();
  for (const e of events) {
    const key = monthFmt.format(at(e.startsOn));
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return (
    <div className="space-y-4">
      {[...groups].map(([month, rows]) => (
        <Card key={month}>
          <CardHeader>
            <CardTitle>{month}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {rows.map((e) => (
                <li key={e.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-32 shrink-0 text-sm tabular-nums text-muted-foreground">{dateRange(e)}</span>
                    <span className="font-medium">{e.title}</span>
                    <Badge variant={e.kind === "holiday" ? "success" : "outline"}>{KIND_LABEL[e.kind] ?? humanize(e.kind)}</Badge>
                    {e.audience === "staff" && <Badge variant="outline">Staff only</Badge>}
                  </div>
                  {e.description && <p className="text-sm text-muted-foreground">{e.description}</p>}
                  {actions?.(e)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
