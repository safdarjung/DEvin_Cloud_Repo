import type { Metadata } from "next";
import { FadeIn } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { cn } from "cn";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { istNowHHMM, weekdayOf } from "@/modules/people/portal-dates";
import { timetableForStudent, toHHMM, type SectionTimetableSlot } from "@/modules/timetable/queries";
import { TimetableBookLink } from "@/modules/textbooks/components/BookLinks";
import { textbooksForStudent } from "@/modules/textbooks/queries";

export const metadata: Metadata = { title: "Timetable" };

const DAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
];

export default async function PortalTimetablePage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "timetable");
  requirePermission(ctx, "timetable.read");

  const selection = await resolvePortalSelection(ctx, allParams.student, `/${institutionSlug}/portal/timetable`, allParams);
  const [slots, books] = await Promise.all([timetableForStudent(ctx, selection.studentId), textbooksForStudent(ctx, selection.studentId)]);

  const todayWeekday = weekdayOf(todayInInstitutionTimezone(ctx));
  const nowHHMM = istNowHHMM();
  const periods = [...new Map(slots.map((s) => [s.period.seq, s.period])).values()].sort((a, b) => a.seq - b.seq);
  const cell = new Map<string, SectionTimetableSlot>(slots.map((s) => [`${s.weekday}:${s.period.seq}`, s]));

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref=""
        canStudy={hasPermission(ctx, "ai.study")}
      />
      {periods.length === 0 ? (
        <EmptyState title="No timetable yet" description="The school hasn't published a timetable for this class." />
      ) : (
        <FadeIn key={selection.studentId}>
          <p className="mb-3 text-sm text-muted-foreground">{selection.studentName}&apos;s weekly timetable. Today is highlighted.</p>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th scope="col" className="w-28 px-3 py-2 font-medium">Period</th>
                  {DAYS.map((d) => (
                    <th key={d.n} scope="col" className={cn("px-3 py-2 font-medium", d.n === todayWeekday && "bg-primary/10 text-primary")}>
                      {d.label}
                      {d.n === todayWeekday && <span className="sr-only"> (today)</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => {
                  const isNow = nowHHMM >= toHHMM(p.startsAt) && nowHHMM < toHHMM(p.endsAt);
                  return (
                    <tr key={p.seq} className="border-b last:border-0 align-top">
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <span className="block font-medium">{p.name}</span>
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {toHHMM(p.startsAt)}–{toHHMM(p.endsAt)}
                        </span>
                      </th>
                      {DAYS.map((d) => {
                        const s = cell.get(`${d.n}:${p.seq}`);
                        const current = isNow && d.n === todayWeekday;
                        return (
                          <td
                            key={d.n}
                            aria-current={current ? "true" : undefined}
                            className={cn("px-3 py-2", d.n === todayWeekday && "bg-primary/5", current && "bg-primary/15 ring-1 ring-inset ring-primary/40")}
                          >
                            {s ? (
                              <>
                                <span className="block font-medium">{s.subject?.name ?? "—"}</span>
                                <span className="block text-xs text-muted-foreground">{[s.teacher.name, s.room?.name].filter(Boolean).join(" · ")}</span>
                                {s.subject && <TimetableBookLink books={books.bySubject[s.subject.id]} subjectName={s.subject.name} />}
                                {current && <Badge variant="info" className="mt-1">Now</Badge>}
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </FadeIn>
      )}
    </>
  );
}
