import { FadeIn } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { AnimatedList, ProgressBar } from "@/components/widgets/viz";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { AckButton } from "@/modules/diary/components/AckButton";
import { diaryForStudent } from "@/modules/diary/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { notFound } from "next/navigation";

const HISTORY_DAYS = 180;
const date = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function PortalUpdatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { student: studentParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  if (ctx.membership.role !== "guardian") notFound();
  requirePermission(ctx, "assignment.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/updates`);
  const today = todayInInstitutionTimezone(ctx);
  const entries = await diaryForStudent(ctx, selection.studentId, shiftDays(today, -HISTORY_DAYS), shiftDays(today, 30));
  const needsAck = entries.filter((e) => e.requiresAck);
  const acked = needsAck.filter((e) => e.acknowledged).length;

  return (
    <>
      <PortalNav institutionSlug={institutionSlug} role="guardian" selection={selection} activeHref="/updates" />
      <h2 className="mb-1 text-xl font-semibold tracking-tight">Teacher updates</h2>
      <p className="mb-4 text-sm text-muted-foreground">Class diary entries for {selection.studentName}, last {HISTORY_DAYS} days.</p>

      {entries.length === 0 ? (
        <EmptyState title="No updates yet" description="When a teacher posts to the class diary it appears here." />
      ) : (
        <FadeIn key={selection.studentId} className="space-y-4">
          {needsAck.length > 0 && (
            <Card>
              <CardContent>
                <ProgressBar
                  label="Updates acknowledged"
                  value={acked}
                  max={needsAck.length}
                  valueLabel={`${acked} of ${needsAck.length} that ask for it`}
                  tone={acked === needsAck.length ? "success" : "warning"}
                />
              </CardContent>
            </Card>
          )}
        <AnimatedList ariaLabel="Teacher updates" className="grid gap-3 space-y-0">
          {entries.map((e) => (
            <Card key={e.id}>
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {date.format(new Date(`${e.entryDate}T00:00:00Z`))}
                      {e.subject ? ` · ${e.subject.name}` : ""}
                      {e.dueDate ? ` · Due ${date.format(new Date(`${e.dueDate}T00:00:00Z`))}` : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">{e.body}</p>
                  </div>
                  {e.requiresAck &&
                    (e.acknowledged ? (
                      <Badge variant="success" className="self-start">Acknowledged</Badge>
                    ) : (
                      <AckButton institutionSlug={institutionSlug} studentId={selection.studentId} entryId={e.id} />
                    ))}
                </CardContent>
            </Card>
          ))}
        </AnimatedList>
        </FadeIn>
      )}
    </>
  );
}
