import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { listSectionOptions } from "@/modules/exams/queries";
import { PtmEventForm, PublishPtmButton } from "@/modules/ptm/components/PtmAdmin";
import { CloseSurveyButton, SurveyForm } from "@/modules/ptm/components/SurveyAdmin";
import { ptmEvents } from "@/modules/ptm/queries";
import { surveyList } from "@/modules/ptm/survey.queries";

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Parent-teacher meetings and parent surveys (admin). Authorization:
// `ptm.manage` for events; surveys additionally need `survey.manage`.
export default async function PtmAdminPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "ptm");
  requirePermission(ctx, "ptm.manage");
  const canSurveys = hasPermission(ctx, "survey.manage");

  const [eventsR, sectionsR, surveysR] = await Promise.allSettled([
    ptmEvents(ctx, true),
    listSectionOptions(ctx),
    canSurveys ? surveyList(ctx) : Promise.resolve([]),
  ]);
  for (const r of [eventsR, sectionsR, surveysR]) if (r.status === "rejected") console.error("ptm page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const sections = sectionsR.status === "fulfilled" ? sectionsR.value : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Parent-teacher meetings" description="Create meeting days, publish them to guardians, and run parent surveys." />

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
                  {eventsR.value.map((e) => (
                    <TableRow key={e.id}>
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
                    {surveysR.value.map((s) => (
                      <TableRow key={s.id}>
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
