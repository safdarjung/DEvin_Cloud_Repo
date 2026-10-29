import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Exams</h1>
        <p className="text-muted-foreground text-sm">Results and report cards appear in your portal once published.</p>
      </div>
    );
  }

  const [exams, myPapers] = await Promise.all([
    canManage ? listExams(ctx) : Promise.resolve([]),
    canEnter ? getMyPapers(ctx) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-8">
      {canManage && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Exams</h1>
            <Button asChild>
              <Link href={`/${institutionSlug}/exams/new`}>New exam</Link>
            </Button>
          </div>
          {exams.length === 0 ? (
            <p className="text-muted-foreground text-sm">No exams yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {exams.map((exam) => (
                <li key={exam.id} className="flex items-center justify-between p-3">
                  <Link href={`/${institutionSlug}/exams/${exam.id}`} className="hover:underline">
                    {exam.name} <span className="text-muted-foreground text-sm">· {exam.termName}</span>
                  </Link>
                  <Badge variant={exam.status === "published" ? "default" : "secondary"}>{exam.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-sm font-medium">My papers</h2>
        {myPapers.length === 0 ? (
          <p className="text-muted-foreground text-sm">No papers open for marks entry.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {myPapers.map((paper) => (
              <li key={paper.id} className="flex items-center justify-between p-3">
                <Link href={`/${institutionSlug}/exams/${paper.examId}/papers/${paper.id}`} className="hover:underline">
                  {paper.examName} · {paper.sectionLabel} {paper.subjectName}
                </Link>
                <Badge variant="secondary">{paper.examStatus}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
