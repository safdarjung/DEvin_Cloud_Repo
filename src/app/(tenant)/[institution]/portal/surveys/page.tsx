import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Stagger, StaggerItem } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { ProgressBar } from "@/components/widgets/viz";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { SurveyForm, type SurveyQuestion } from "@/modules/ptm/components/SurveyForm";
import { surveyMine } from "@/modules/ptm/survey.queries";

export const metadata: Metadata = { title: "Surveys" };

const closes = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function PortalSurveysPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const { student: studentParam } = allParams;
  const ctx = await getTenantContext(institutionSlug);
  if (ctx.membership.role !== "guardian") notFound();
  requirePermission(ctx, "survey.respond");

  // Surveys are addressed to the guardian, not a child; the id only keeps the selected child in the URL.
  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/surveys`, allParams);
  const surveys = await surveyMine(ctx);

  return (
    <>
      <PortalNav institutionSlug={institutionSlug} role="guardian" selection={selection} activeHref="/surveys" />
      {surveys.length === 0 ? (
        <EmptyState title="No open surveys" description="Surveys from the school appear here while they are open." />
      ) : (
        <div className="space-y-4">
        {surveys.length > 1 && (
          <Card>
            <CardContent>
              <ProgressBar
                label="Surveys answered"
                value={surveys.filter((s) => s.responded).length}
                max={surveys.length}
                valueLabel={`${surveys.filter((s) => s.responded).length} of ${surveys.length}`}
                tone="success"
              />
            </CardContent>
          </Card>
        )}
        <Stagger className="grid gap-4 lg:grid-cols-2 *:min-w-0">
          {surveys.map((s) => (
            <StaggerItem key={s.id}>
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle>{s.title}</CardTitle>
                    {s.responded && <Badge variant="success">Responded</Badge>}
                  </div>
                  {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                  <p className="text-xs text-muted-foreground">
                    Closes {closes.format(new Date(s.closesAt))}
                    {s.isAnonymous ? " · Responses are anonymous" : ""}
                  </p>
                </CardHeader>
                {!s.responded && (
                  <CardContent>
                    <SurveyForm institutionSlug={institutionSlug} surveyId={s.id} questions={s.questions as SurveyQuestion[]} />
                  </CardContent>
                )}
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
        </div>
      )}
    </>
  );
}
