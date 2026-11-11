import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule } from "@/lib/auth/require";
import { AppError } from "@/lib/actions/result";
import { humanize } from "@/lib/format";
import { listSectionOptions } from "@/modules/exams/queries";
import { PtmEventForm, PublishPtmButton } from "@/modules/ptm/components/PtmAdmin";
import { CloseSurveyButton, SurveyForm } from "@/modules/ptm/components/SurveyAdmin";
import { PtmSlotsManager } from "@/modules/ptm/components/PtmSlotsManager";
import { ptmEvents, ptmTeacherSchedule } from "@/modules/ptm/queries";
import { surveyList } from "@/modules/ptm/survey.queries";
import { aiTaskOn } from "@/modules/ai/task-route";
import { FadeIn } from "@/components/motion";
import { ProgressBar } from "@/components/widgets/viz";

export const metadata: Metadata = { title: "Parent meetings" };

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const slotDate = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// Parent-teacher meetings. One page, two jobs gated separately:
// `ptm.manage` creates/publishes meeting days (surveys also need `survey.manage`);
// `ptm.slot.manage` lets a teacher open their own slots on published days.
export default async function PtmPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "ptm");
  const canManage = hasPermission(ctx, "ptm.manage");
  const canSlots = hasPermission(ctx, "ptm.slot.manage");
  if (!canManage && !canSlots) throw new AppError("forbidden", "You do not have access to parent-teacher meetings.");
  const canSurveys = canManage && hasPermission(ctx, "survey.manage");
  const canBrief = aiTaskOn(ctx, "ptm_brief");

  const [eventsR, sectionsR, surveysR] = await Promise.allSettled([
    ptmEvents(ctx, canManage),
    canManage ? listSectionOptions(ctx) : Promise.resolve([]),
    canSurveys ? surveyList(ctx) : Promise.resolve([]),
  ]);
  for (const r of [eventsR, sectionsR, surveysR]) if (r.status === "rejected") console.error("ptm page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const sections = sectionsR.status === "fulfilled" ? sectionsR.value : [];

  // Only published meetings accept bookings; RLS narrows ptm_slots to the caller's own for a teacher.
  const published = eventsR.status === "fulfilled" ? eventsR.value.filter((e) => e.status === "published") : [];
  const staffId = ctx.membership.staffId;
  const schedules = canSlots && staffId ? await Promise.all(published.map((e) => ptmTeacherSchedule(ctx, e.id))) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parent-teacher meetings"
        description={canManage ? "Create meeting days, publish them to guardians, and run parent surveys." : "Open time slots for parents to book with you."}
      />

      {canSlots && (
        <section aria-labelledby="ptm-my-slots" className="max-w-3xl space-y-3">
          {canManage && (
            <h2 id="ptm-my-slots" className="text-base font-semibold">
              My slots
            </h2>
          )}
          {!staffId ? (
            <EmptyState title="No staff profile on this account" description="Slots are tied to a staff profile. Ask an administrator to link yours." />
          ) : published.length === 0 ? (
            <EmptyState title="No published meetings" description="When the school publishes a parent-teacher meeting, you can open your slots here." />
          ) : (
            published.map((e, i) => (
              <FadeIn key={e.id} delay={Math.min(i, 8) * 0.04} className="motion-safe:fill-mode-backwards">
              <Card>
                <CardHeader>
                  <CardTitle>{e.title}</CardTitle>
                  <CardDescription>
                    {slotDate.format(new Date(`${e.eventDate}T00:00:00Z`))} · {e.dayStartsAt} to {e.dayEndsAt} · {e.slotMinutes} min slots ·{" "}
                    {schedules[i].filter((s) => s.booking).length} booked
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {schedules[i].length > 0 && (
                    <ProgressBar
                      label="Slots booked"
                      value={schedules[i].filter((s) => s.booking).length}
                      max={schedules[i].length}
                      valueLabel={`${schedules[i].filter((s) => s.booking).length} / ${schedules[i].length}`}
                    />
                  )}
                  <PtmSlotsManager institutionSlug={institutionSlug} eventId={e.id} dayStartsAt={e.dayStartsAt} dayEndsAt={e.dayEndsAt} slots={schedules[i]} canBrief={canBrief} />
                </CardContent>
              </Card>
              </FadeIn>
            ))
          )}
        </section>
      )}

      {canManage && (
      <section aria-labelledby="ptm-events" className="space-y-3">
        <h2 id="ptm-events" className="text-base font-semibold">
          Meetings
        </h2>
        {eventsR.status === "rejected" ? (
          <ErrorState title="Could not load meetings" description="Refresh to try again." />
        ) : eventsR.value.length === 0 ? (
          <EmptyState title="No meetings yet" description="Create the first meeting day below. It stays a draft until you publish it." />
        ) : (
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Meeting</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="hidden sm:table-cell">Slots</TableHead>
                    <TableHead className="text-right">Sections</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eventsR.value.map((e, i) => (
                    <TableRow key={e.id} className="motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-backwards motion-safe:duration-200" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                      <TableCell className="font-medium">{e.title}</TableCell>
                      <TableCell>{dateFmt.format(new Date(`${e.eventDate}T00:00:00+05:30`))}</TableCell>
                      <TableCell className="hidden tabular-nums sm:table-cell">
                        {e.dayStartsAt}–{e.dayEndsAt}, {e.slotMinutes} min
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{e.classSectionIds.length}</TableCell>
                      <TableCell>
                        <Badge variant={e.status === "published" ? "success" : "outline"}>{humanize(e.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{e.status === "draft" && <PublishPtmButton institutionSlug={institutionSlug} eventId={e.id} />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>New meeting</CardTitle>
          </CardHeader>
          <CardContent>
            <PtmEventForm institutionSlug={institutionSlug} sections={sections} />
          </CardContent>
        </Card>
      </section>
      )}

      {canSurveys && (
        <section aria-labelledby="ptm-surveys" className="space-y-3">
          <h2 id="ptm-surveys" className="text-base font-semibold">
            Surveys
          </h2>
          {surveysR.status === "rejected" ? (
            <ErrorState title="Could not load surveys" description="Refresh to try again." />
          ) : surveysR.value.length === 0 ? (
            <EmptyState title="No surveys yet" description="Publish a short survey to guardians or teachers below." />
          ) : (
            <Card>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Survey</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Questions</TableHead>
                      <TableHead className="hidden sm:table-cell">Closes</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {surveysR.value.map((s, i) => (
                      <TableRow key={s.id} className="motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-backwards motion-safe:duration-200" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                        <TableCell className="font-medium">{s.title}</TableCell>
                        <TableCell>
                          <Badge variant={s.status === "open" ? "success" : "outline"}>{humanize(s.status)}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{s.questionCount}</TableCell>
                        <TableCell className="hidden sm:table-cell">{dateTimeFmt.format(new Date(s.closesAt))}</TableCell>
                        <TableCell className="text-right">{s.status === "open" && <CloseSurveyButton institutionSlug={institutionSlug} surveyId={s.id} title={s.title} />}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>New survey</CardTitle>
            </CardHeader>
            <CardContent>
              <SurveyForm institutionSlug={institutionSlug} />
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
