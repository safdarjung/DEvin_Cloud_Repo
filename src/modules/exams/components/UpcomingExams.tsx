import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/states";
import { Widget } from "@/components/widgets/widget";
import type { StudentUpcomingExamPaper } from "@/modules/exams/queries";

const TZ = "Asia/Kolkata";
const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });

/** Upcoming exam papers for one student (next 60 days). `papers` null = the query failed. */
export function UpcomingExams({ papers }: { papers: StudentUpcomingExamPaper[] | null }) {
  return (
    <Widget
      title="Upcoming exams"
      icon={<CalendarDays />}
      isEmpty={papers !== null && papers.length === 0}
      empty={<EmptyState title="No exams scheduled in the next 60 days" />}
    >
      {papers === null ? (
        <p role="alert" className="text-sm text-muted-foreground">
          This section couldn&apos;t load. Refresh the page to try again.
        </p>
      ) : (
        <ul className="divide-y">
          {papers.slice(0, 6).map((p) => {
            const at = new Date(p.scheduledAt);
            return (
              <li key={p.paperId} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.subjectName}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.examName}</p>
                </div>
                <p className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {dateFmt.format(at)}
                  <br />
                  {timeFmt.format(at)} IST
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Widget>
  );
}
