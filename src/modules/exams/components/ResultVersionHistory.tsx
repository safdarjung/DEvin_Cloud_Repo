// T-020 — extracted from the student report-card page's inline version
// list (T-019) so the recheck decision page can reuse it. Exam roles only
// (07 §2.2): `history` is already `null` for anyone else — `getResultHistory`
// enforces that server-side (rule 3), this component only renders what it's
// given, never re-decides who may see it.
import type { ResultDetail } from "@/modules/exams/queries";

interface ResultVersionHistoryProps {
  history: ResultDetail[] | null;
}

export function ResultVersionHistory({ history }: ResultVersionHistoryProps) {
  if (!history || history.length < 2) return null;

  return (
    <section className="space-y-2 print:hidden">
      <h2 className="text-sm font-medium">Version history</h2>
      <ul className="text-muted-foreground space-y-1 text-sm">
        {history.map((version) => (
          <li key={version.id}>
            v{version.versionNo} — {version.grade}, {version.percentage}% — published{" "}
            {new Date(version.publishedAt).toLocaleDateString()}
          </li>
        ))}
      </ul>
    </section>
  );
}
