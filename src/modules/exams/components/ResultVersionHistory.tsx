// T-020 — extracted from the student report-card page's inline version
// list (T-019) so the recheck decision page can reuse it. Exam roles only
// (07 §2.2): `history` is already `null` for anyone else — `getResultHistory`
// enforces that server-side (rule 3), this component only renders what it's
// given, never re-decides who may see it.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/motion";
import type { ResultDetail } from "@/modules/exams/queries";

interface ResultVersionHistoryProps {
  history: ResultDetail[] | null;
}

export function ResultVersionHistory({ history }: ResultVersionHistoryProps) {
  if (!history || history.length < 2) return null;

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>Version history</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-1 text-sm">
          {history.map((version, i) => (
            <FadeIn as="li" delay={Math.min(i, 8) * 0.04} key={version.id} className="motion-safe:fill-mode-backwards flex flex-wrap gap-x-2">
              <span className="font-medium">v{version.versionNo}</span>
              <span>
                {version.grade}, {version.percentage}%
              </span>
              <span className="text-muted-foreground">published {new Date(version.publishedAt).toLocaleDateString()}</span>
            </FadeIn>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
