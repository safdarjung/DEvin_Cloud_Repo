import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { humanize } from "@/lib/format";
import { FadeIn } from "@/components/motion";
import { BarList } from "@/components/widgets/viz";
import { examStatusVariant } from "@/modules/exams/status";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission, requireModule } from "@/lib/auth/require";
import { getMyPapers, listExams } from "@/modules/exams/queries";

export default async function ExamsPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "exam.result.read");

  const canManage = hasPermission(ctx, "exam.manage");
  const canEnter = hasPermission(ctx, "exam.marks.enter");

  if (!canManage && !canEnter) {
    return (
      <div className="space-y-4">
        <PageHeader title="Exams" />
        <EmptyState title="Nothing to manage here" description="Results and report cards appear in your portal once published." />
      </div>
    );
  }

  const [exams, myPapers] = await Promise.all([
    canManage ? listExams(ctx) : Promise.resolve([]),
    canEnter ? getMyPapers(ctx) : Promise.resolve([]),
  ]);

  const statusCounts = new Map<string, number>();
  for (const exam of exams) statusCounts.set(exam.status, (statusCounts.get(exam.status) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exams"
        description="Set up exams, enter marks and publish results."
        actions={
          canManage ? (
            <Button asChild>
              <Link href={`/${institutionSlug}/exams/new`}>New exam</Link>
            </Button>
          ) : undefined
        }
      />

      {canManage &&
        (exams.length === 0 ? (
          <EmptyState title="No exams yet" description="Create the first exam to start entering marks." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
          <Card className="min-w-0 lg:col-span-2">
            <CardContent>
              <ul className="divide-y divide-border">
                {exams.map((exam, i) => (
                  <FadeIn as="li" delay={Math.min(i, 8) * 0.04} key={exam.id} className="motion-safe:fill-mode-backwards flex items-center justify-between gap-3 py-3">
                    <Link href={`/${institutionSlug}/exams/${exam.id}`} className="min-w-0 font-medium hover:underline">
                      {exam.name} <span className="text-sm font-normal text-muted-foreground">· {exam.termName}</span>
                    </Link>
                    <Badge variant={examStatusVariant(exam.status)}>{humanize(exam.status)}</Badge>
                  </FadeIn>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Exams by stage</CardTitle>
            </CardHeader>
            <CardContent>
              <BarList
                ariaLabel="Exams by stage"
                items={[...statusCounts].map(([status, count]) => ({ label: humanize(status), value: count }))}
              />
            </CardContent>
          </Card>
          </div>
        ))}

      <Card>
        <CardHeader>
          <CardTitle>My papers</CardTitle>
        </CardHeader>
        <CardContent>
          {myPapers.length === 0 ? (
            <EmptyState title="No papers open for marks entry" />
          ) : (
            <ul className="divide-y divide-border">
              {myPapers.map((paper, i) => (
                <FadeIn as="li" delay={Math.min(i, 8) * 0.04} key={paper.id} className="motion-safe:fill-mode-backwards flex items-center justify-between gap-3 py-3">
                  <Link href={`/${institutionSlug}/exams/${paper.examId}/papers/${paper.id}`} className="min-w-0 hover:underline">
                    {paper.examName} · {paper.sectionLabel} {paper.subjectName}
                  </Link>
                  <Badge variant={examStatusVariant(paper.examStatus)}>{humanize(paper.examStatus)}</Badge>
                </FadeIn>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
