import Link from "next/link";
import type { ReactNode } from "react";
import { Sun } from "lucide-react";
import { Widget } from "@/components/widgets/widget";
import type { TimetablePeriod } from "@/components/widgets/timetable-widget";
import type { StudentUpcomingExamPaper } from "@/modules/exams/queries";
import type { LibraryLoanRow } from "@/modules/library/queries";
import { countdown, daysBetween, fmtIsoDate, istDay, portalDate } from "@/modules/people/portal-dates";

/** Each section: undefined = module off (hidden), null = its query failed, array/value = data. */
export interface MyDayProps {
  basePath: string;
  query: string;
  today: string;
  nowHHMM: string;
  periods: TimetablePeriod[] | null | undefined;
  assignments: { id: string; title: string; dueAt: string }[] | undefined;
  nextExam: StudentUpcomingExamPaper | null | undefined | false;
  books: LibraryLoanRow[] | null | undefined;
}

function Section({ title, href, children }: { title: string; href: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Link href={href} className="text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">
        {title}
      </Link>
      <div className="mt-1 space-y-0.5 text-sm">{children}</div>
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <p className="text-muted-foreground">{children}</p>;
const Failed = () => <Muted>Couldn&apos;t load.</Muted>;

export function MyDayCard({ basePath, query, today, nowHHMM, periods, assignments, nextExam, books }: MyDayProps) {
  const remaining = periods?.filter((p) => p.end > nowHHMM) ?? [];
  const dueBooks = books?.filter((b) => !b.returnedOn && daysBetween(today, b.dueOn) <= 7) ?? [];
  const exam = nextExam || null;
  return (
    <Widget title="My day" icon={<Sun />} className="mb-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {periods !== undefined && (
          <Section title="Periods left today" href={`${basePath}/timetable${query}`}>
            {periods === null ? <Failed /> : remaining.length === 0 ? <Muted>No more periods today.</Muted> : remaining.slice(0, 4).map((p) => (
              <p key={p.start} className="truncate">
                <span className="tabular-nums text-muted-foreground">{p.start}</span> {p.title}
                {p.isCurrent && <span className="text-primary"> · now</span>}
              </p>
            ))}
          </Section>
        )}
        {assignments !== undefined && (
          <Section title="Due in 3 days" href={`${basePath}/assignments${query}`}>
            {assignments.length === 0 ? <Muted>Nothing due.</Muted> : assignments.slice(0, 4).map((a) => (
              <p key={a.id} className="truncate">{a.title} <span className="text-muted-foreground">· {portalDate.format(new Date(a.dueAt))}</span></p>
            ))}
          </Section>
        )}
        {nextExam !== undefined && (
          <Section title="Next exam" href={`${basePath}/exams${query}`}>
            {nextExam === null ? <Failed /> : !exam ? <Muted>No exams scheduled.</Muted> : (
              <p className="truncate">
                {exam.subjectName} <span className="text-muted-foreground">· {countdown(daysBetween(today, istDay(exam.scheduledAt)))}</span>
              </p>
            )}
          </Section>
        )}
        {books !== undefined && (
          <Section title="Library due this week" href={`${basePath}/library${query}`}>
            {books === null ? <Failed /> : dueBooks.length === 0 ? <Muted>No books due.</Muted> : dueBooks.slice(0, 3).map((b) => (
              <p key={b.loanId} className="truncate">
                {b.title} <span className={b.daysOverdue > 0 ? "text-destructive" : "text-muted-foreground"}>· {b.daysOverdue > 0 ? "overdue" : fmtIsoDate(b.dueOn)}</span>
              </p>
            ))}
          </Section>
        )}
      </div>
    </Widget>
  );
}
