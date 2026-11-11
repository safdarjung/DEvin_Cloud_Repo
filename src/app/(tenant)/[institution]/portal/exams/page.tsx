import type { Metadata } from "next";
import Link from "next/link";
import { FadeIn } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { listStudentSeats } from "@/modules/exam-seating/queries";
import { listResultsForStudent, upcomingExamsForStudent } from "@/modules/exams/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { countdown, daysBetween, istDay, portalDate, portalTime } from "@/modules/people/portal-dates";

export const metadata: Metadata = { title: "Exams" };

const th = "px-3 py-2 text-left font-medium";
const td = "px-3 py-2";

export default async function PortalExamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "exam.result.read");

  const selection = await resolvePortalSelection(ctx, allParams.student, `/${institutionSlug}/portal/exams`, allParams);
  const q = `?student=${selection.studentId}`;
  const canSeats = hasPermission(ctx, "exam.seating.read");
  const [papersR, resultsR, seatsR] = await Promise.allSettled([
    upcomingExamsForStudent(ctx, selection.studentId, 60),
    listResultsForStudent(ctx, selection.studentId),
    canSeats ? listStudentSeats(ctx, selection.studentId) : Promise.resolve([]),
  ]);
  const papers = papersR.status === "fulfilled" ? papersR.value : null;
  const results = resultsR.status === "fulfilled" ? resultsR.value : [];
  // Seating is matched by exam name + local date (a plan is one slot of an exam).
  const seats = new Map((seatsR.status === "fulfilled" ? seatsR.value : []).map((s) => [`${s.examName}|${s.localDate}`, s]));
  const today = todayInInstitutionTimezone(ctx);

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref=""
        canStudy={hasPermission(ctx, "ai.study")}
      />
      <FadeIn key={selection.studentId} className="space-y-6">
        <section aria-labelledby="up-h">
          <h2 id="up-h" className="mb-2 text-base font-semibold">Upcoming papers</h2>
          {papers === null ? (
            <p role="alert" className="text-sm text-muted-foreground">Upcoming papers couldn&apos;t load. Refresh the page to try again.</p>
          ) : papers.length === 0 ? (
            <EmptyState title="No exams scheduled" description="Papers scheduled in the next 60 days appear here." />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th scope="col" className={th}>Subject</th>
                    <th scope="col" className={th}>Date</th>
                    <th scope="col" className={th}>When</th>
                    <th scope="col" className={th}>Seat</th>
                  </tr>
                </thead>
                <tbody>
                  {papers.map((p) => {
                    const at = new Date(p.scheduledAt);
                    const day = istDay(at);
                    const seat = seats.get(`${p.examName}|${day}`);
                    return (
                      <tr key={p.paperId} className="border-b last:border-0">
                        <td className={td}>
                          <span className="block font-medium">{p.subjectName}</span>
                          <span className="block text-xs text-muted-foreground">{p.examName}</span>
                        </td>
                        <td className={td}>
                          {portalDate.format(at)}
                          <span className="block text-xs text-muted-foreground">
                            {portalTime.format(at)} IST · {p.durationMinutes} min
                          </span>
                        </td>
                        <td className={td}>
                          <Badge variant={daysBetween(today, day) <= 3 ? "warning" : "info"}>{countdown(daysBetween(today, day))}</Badge>
                        </td>
                        <td className={td}>{seat ? `${seat.room.name}, seat ${seat.seatNo}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="res-h">
          <h2 id="res-h" className="mb-2 text-base font-semibold">Published results</h2>
          {results.length === 0 ? (
            <EmptyState title="No published results yet" description="Results appear here once the school publishes them." />
          ) : (
            <ul className="divide-y rounded-xl border">
              {results.map((r) => (
                <li key={r.examId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.examName || humanize(r.examType) || "Exam"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {+Number(r.percentage).toFixed(1)}% · Grade {r.grade}
                    </span>
                  </span>
                  <Link href={`/${institutionSlug}/portal/results${q}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    View report card
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </FadeIn>
    </>
  );
}
