import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { humanize } from "@/lib/format";
import { examStatusVariant } from "@/modules/exams/status";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { getMyPapers, listExams } from "@/modules/exams/queries";

export default async function ExamsPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
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
          <Card>
            <CardContent>
              <ul className="divide-y divide-border">
                {exams.map((exam) => (
                  <li key={exam.id} className="flex items-center justify-between gap-3 py-3">
                    <Link href={`/${institutionSlug}/exams/${exam.id}`} className="min-w-0 font-medium hover:underline">
                      {exam.name} <span className="text-sm font-normal text-muted-foreground">· {exam.termName}</span>
                    </Link>
                    <Badge variant={examStatusVariant(exam.status)}>{humanize(exam.status)}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
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
              {myPapers.map((paper) => (
                <li key={paper.id} className="flex items-center justify-between gap-3 py-3">
                  <Link href={`/${institutionSlug}/exams/${paper.examId}/papers/${paper.id}`} className="min-w-0 hover:underline">
                    {paper.examName} · {paper.sectionLabel} {paper.subjectName}
                  </Link>
                  <Badge variant={examStatusVariant(paper.examStatus)}>{humanize(paper.examStatus)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
