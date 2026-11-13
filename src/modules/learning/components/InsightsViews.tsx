import { EmptyState } from "@/components/states";
import type { TestAnalytics } from "@/modules/online-tests/marking";
import type { GapRow, RevisionStudent } from "@/modules/learning/recommend";
import { WEAK_PERCENT } from "@/modules/learning/recommend";

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}...` : s);
// Colour plus the number itself: never colour alone.
const heat = (p: number | null) =>
  p === null ? "" : p < 40 ? "bg-destructive/15 text-destructive" : p < WEAK_PERCENT ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-emerald-500/10";
const pctText = (p: number | null) => (p === null ? "no data" : `${Math.round(p)}%`);

const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";
const td = "px-3 py-2 align-top";

function GapTable({ rows, label }: { rows: GapRow[]; label: string }) {
  if (rows.length === 0) return <EmptyState title={`No ${label.toLowerCase()} data yet`} description="Gaps appear once students answer tagged questions in practice or released online tests." />;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[32rem] text-sm">
        <caption className="sr-only">{label} gaps, weakest first</caption>
        <thead className="border-b bg-muted/40">
          <tr>
            <th scope="col" className={th}>{label}</th>
            <th scope="col" className={`${th} text-right`}>Average</th>
            <th scope="col" className={`${th} text-right`}>Weak students</th>
            <th scope="col" className={`${th} text-right`}>Students with data</th>
            {label === "Chapters" && <th scope="col" className={`${th} text-right`}>Mastery</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.unitId}-${r.topicId ?? ""}`} className="border-b last:border-0">
              <th scope="row" className={`${td} text-left font-normal`}>
                {r.topicTitle ?? r.unitTitle}
                {r.topicTitle && <span className="block text-xs text-muted-foreground">{r.unitTitle}</span>}
              </th>
              <td className={`${td} text-right tabular-nums font-medium ${heat(r.averagePercent)}`}>{pctText(r.averagePercent)}</td>
              <td className={`${td} text-right tabular-nums`}>{r.weakStudents}</td>
              <td className={`${td} text-right tabular-nums`}>{r.students}</td>
              {label === "Chapters" && <td className={`${td} text-right tabular-nums`}>{r.masteryAverage === null ? "-" : `${Math.round(r.masteryAverage)}%`}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GapsView({ units, topics }: { units: GapRow[]; topics: GapRow[] }) {
  return (
    <div className="space-y-4" data-testid="section-gaps">
      <GapTable rows={units} label="Chapters" />
      {topics.length > 0 && <GapTable rows={topics.slice(0, 15)} label="Topics" />}
    </div>
  );
}

export function RevisionView({ students }: { students: RevisionStudent[] }) {
  if (students.length === 0) return <EmptyState title="Nobody needs revision" description="No student is below the threshold with enough question data." />;
  return (
    <ul className="grid gap-3 md:grid-cols-2" data-testid="revision-list">
      {students.map((s) => (
        <li key={s.studentId} className="rounded-xl border bg-card p-4">
          <p className="font-medium">{s.studentName || "Student"}</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {s.areas.slice(0, 4).map((a) => (
              <li key={`${a.unitId}-${a.topicId ?? ""}`} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{a.topicTitle ?? a.unitTitle}</span>
                <span className="shrink-0 tabular-nums text-destructive">{Math.round(a.percent)}%</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function TestQuestionsView({ data }: { data: TestAnalytics }) {
  if (data.questions.length === 0) return <EmptyState title="No questions" />;
  const hardest = new Set(data.hardest);
  return (
    <div className="space-y-3" data-testid="test-questions">
      <p className="text-sm text-muted-foreground tabular-nums">
        {data.submitted} submitted · {data.evaluated} evaluated{data.average !== null ? ` · average ${data.average}` : ""}
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[36rem] text-sm">
          <caption className="sr-only">Question-wise results with common wrong answers</caption>
          <thead className="border-b bg-muted/40">
            <tr>
              <th scope="col" className={th}>#</th>
              <th scope="col" className={th}>Question</th>
              <th scope="col" className={`${th} text-right`}>Full marks</th>
              <th scope="col" className={th}>Common wrong answers</th>
            </tr>
          </thead>
          <tbody>
            {data.questions.map((q, i) => {
              const p = q.percentCorrect ?? q.averagePercent;
              return (
                <tr key={q.key} className="border-b last:border-0">
                  <td className={`${td} tabular-nums text-muted-foreground`}>{i + 1}</td>
                  <td className={td}>
                    {clip(q.body)}
                    {hardest.has(q.key) && <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive">hardest</span>}
                  </td>
                  <td className={`${td} text-right tabular-nums font-medium ${heat(p)}`}>{pctText(p)}</td>
                  <td className={td}>
                    {q.commonWrong.length === 0 ? <span className="text-muted-foreground">-</span> : (
                      <ul className="space-y-0.5">{q.commonWrong.map((w) => <li key={w.answer}>{clip(w.answer, 60)} <span className="text-muted-foreground">({w.count})</span></li>)}</ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
