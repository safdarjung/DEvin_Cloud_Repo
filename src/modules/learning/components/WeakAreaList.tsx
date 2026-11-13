import Link from "next/link";
import { EmptyState } from "@/components/states";
import type { WeakArea } from "@/modules/learning/recommend";
import { ChapterSummary } from "@/modules/textbooks/components/ChapterSummary";

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

export interface WeakAreaListProps {
  areas: WeakArea[];
  /** Student view: shows next steps. Guardian view is read-only evidence. */
  readOnly?: boolean;
  subjectNames: Record<string, string>;
  /** Portal base for the practice page, e.g. /demo/portal; student view only. */
  portalBase?: string;
  chapterUrls?: Record<string, string>;
  /** Unit id -> its chapter in a book whose text the school holds (student view: AI summary). */
  chapterSummaries?: Record<string, { textbookId: string; chapterNo: number }>;
  institutionSlug?: string;
}

const evidenceText = (a: WeakArea) => {
  const e = a.evidence;
  const parts = [`${e.questions} ${e.questions === 1 ? "question" : "questions"}`];
  if (e.tests) parts.push(`${e.tests} ${e.tests === 1 ? "test" : "tests"}`);
  if (e.practice) parts.push(`${e.practice} practice`);
  if (e.masteryPercent !== null) parts.push(`mastery ${Math.round(e.masteryPercent)}%`);
  if (e.lastOn) parts.push(`last ${dateFmt.format(new Date(e.lastOn))}`);
  return parts.join(" · ");
};

const linkClass = "inline-flex min-h-10 items-center rounded-md border px-3 text-sm hover:bg-muted";

export function WeakAreaList({ areas, readOnly, subjectNames, portalBase, chapterUrls = {}, chapterSummaries = {}, institutionSlug }: WeakAreaListProps) {
  if (areas.length === 0) {
    return <EmptyState title="No weak topics yet" description="Do a practice quiz or an online test and the topics that need work show here." />;
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2" data-testid="weak-areas">
      {areas.map((a) => {
        const practiceHref = `${portalBase}/practice?unit=${a.unitId}${a.topicId ? `&topic=${a.topicId}` : ""}&mode=${a.next.practice}#practice`;
        const chapter = chapterUrls[a.next.summaryUnitId];
        const summary = institutionSlug ? chapterSummaries[a.next.summaryUnitId] : undefined;
        return (
          <li key={`${a.unitId}-${a.topicId ?? "unit"}`} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{subjectNames[a.subjectId] ?? "Subject"}</p>
                <p className="font-medium">{a.topicTitle ?? a.unitTitle}</p>
                {a.topicTitle && <p className="text-xs text-muted-foreground">{a.unitTitle}</p>}
              </div>
              <p className="shrink-0 text-2xl font-semibold tabular-nums text-destructive">{Math.round(a.percent)}%</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{evidenceText(a)}</p>
            {!readOnly && portalBase && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={practiceHref} className={`${linkClass} bg-foreground text-background hover:bg-foreground/90`}>
                  Practice now{a.next.practice === "bank" ? ` (${a.next.bankQuestions} ${a.next.bankQuestions === 1 ? "question" : "questions"})` : " (AI quiz)"}
                </Link>
                {!summary && chapter && (
                  <a href={chapter} target="_blank" rel="noopener noreferrer" className={linkClass}>Read chapter</a>
                )}
                <Link href={`${portalBase}/study/search?q=${encodeURIComponent(a.next.searchQuery)}`} className={linkClass}>
                  Search textbook
                </Link>
              </div>
            )}
            {!readOnly && portalBase && summary && institutionSlug && (
              <div className="mt-3">
                <ChapterSummary institutionSlug={institutionSlug} textbookId={summary.textbookId} chapterNo={summary.chapterNo} label="Read summary" />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
