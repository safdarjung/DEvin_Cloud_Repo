// Renders one saved or draft study item by format. No hooks: used from server
// pages and client components alike. Answers to active-recall prompts and
// exam questions sit behind native <details> (keyboard and screen-reader
// friendly, no script). Plain text only: React escapes everything.
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { QuizQuestion, StudyFormat } from "@/modules/study/formats";

type C = Record<string, unknown>;
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function AiLabel({ fromTeacher }: { fromTeacher?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {fromTeacher && <Badge>From your teacher</Badge>}
      <Badge variant="secondary" className="gap-1">
        <Sparkles className="size-3" aria-hidden />
        AI-generated study help{fromTeacher ? ", reviewed by your teacher" : ""}
      </Badge>
    </span>
  );
}

function Reveal({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border bg-card px-3 py-2 open:bg-muted/40">
      <summary className="min-h-10 cursor-pointer list-none py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="mr-1 inline-block text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none">›</span>
        {summary}
      </summary>
      <div className="pb-1 pt-1 text-sm text-muted-foreground">{children}</div>
    </details>
  );
}

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="ml-4 list-disc space-y-1 text-sm marker:text-muted-foreground">
    {items.map((t, i) => (
      <li key={i}>{t}</li>
    ))}
  </ul>
);

function Pairs({ rows, dense }: { rows: [string, string][]; dense?: boolean }) {
  return (
    <dl className={dense ? "grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(8rem,auto)_1fr]" : "space-y-3"}>
      {rows.map(([k, v], i) => (
        <div key={i} className={dense ? "contents" : ""}>
          <dt className="text-sm font-semibold">{k}</dt>
          <dd className="text-sm text-muted-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MaterialView({ format, content, showQuizAnswers }: { format: StudyFormat; content: unknown; showQuizAnswers?: boolean }) {
  const c = (content ?? {}) as C;
  switch (format) {
    case "quick_summary":
      return (
        <div className="space-y-3">
          <p className="text-[15px] leading-relaxed">{str(c.summary)}</p>
          <Bullets items={arr<string>(c.keyPoints)} />
        </div>
      );
    case "revision_notes":
      return (
        <div className="space-y-4">
          {arr<C>(c.sections).map((s, i) => (
            <section key={i}>
              <h3 className="mb-1 text-sm font-semibold">{str(s.heading)}</h3>
              <Bullets items={arr<string>(s.points)} />
            </section>
          ))}
        </div>
      );
    case "cheat_sheet":
      return <Pairs dense rows={arr<C>(c.items).map((x) => [str(x.label), str(x.detail)])} />;
    case "key_concepts":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {arr<C>(c.concepts).map((x, i) => (
            <div key={i} className="rounded-lg border p-3">
              <p className="text-sm font-semibold">{str(x.name)}</p>
              <p className="mt-1 text-sm">{str(x.explanation)}</p>
              <p className="mt-2 text-xs text-muted-foreground">Example: {str(x.example)}</p>
            </div>
          ))}
        </div>
      );
    case "glossary":
      return <Pairs rows={arr<C>(c.terms).map((x) => [str(x.term), str(x.definition)])} />;
    case "high_yield":
      return (
        <ol className="space-y-2">
          {arr<C>(c.points).map((x, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">{i + 1}</span>
              <span className="text-sm">
                {str(x.point)} <span className="text-muted-foreground">— {str(x.why)}</span>
              </span>
            </li>
          ))}
        </ol>
      );
    case "exam_notes":
      return (
        <div className="space-y-3">
          {arr<C>(c.likelyQuestions).map((q, i) => (
            <Reveal key={i} summary={str(q.question)}>
              <ol className="ml-4 list-decimal space-y-1">
                {arr<string>(q.answerOutline).map((s, j) => (
                  <li key={j}>{s}</li>
                ))}
              </ol>
            </Reveal>
          ))}
          <div>
            <p className="mb-1 text-sm font-semibold">Common mistakes</p>
            <Bullets items={arr<string>(c.commonMistakes)} />
          </div>
        </div>
      );
    case "one_page":
      return (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm leading-relaxed">{str(c.overview)}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {arr<C>(c.sections).map((s, i) => (
              <section key={i}>
                <h3 className="mb-1 text-sm font-semibold">{str(s.heading)}</h3>
                <Bullets items={arr<string>(s.bullets)} />
              </section>
            ))}
          </div>
          <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium">Remember: {str(c.remember)}</p>
        </div>
      );
    case "active_recall":
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Answer each one in your head or on paper first, then open it to check.</p>
          {arr<C>(c.prompts).map((p, i) => (
            <Reveal key={i} summary={str(p.prompt)}>
              {str(p.answer)}
            </Reveal>
          ))}
        </div>
      );
    case "flashcards":
      return (
        <ul className="grid gap-2 sm:grid-cols-2">
          {arr<C>(c.cards).map((card, i) => (
            <li key={str(card.id) || i} className="rounded-lg border p-3">
              <p className="text-sm font-medium">{str(card.front)}</p>
              <p className="mt-1 text-sm text-muted-foreground">{str(card.back)}</p>
            </li>
          ))}
        </ul>
      );
    case "quiz": {
      const questions = arr<QuizQuestion>(c.questions);
      return (
        <ol className="space-y-3">
          {questions.map((q, i) => (
            <li key={i} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                {i + 1}. {q.stem} <span className="text-xs font-normal text-muted-foreground">({q.type === "mcq" ? "multiple choice" : q.type === "true_false" ? "true / false" : "short answer"})</span>
              </p>
              {q.type === "mcq" && (
                <ul className="mt-1 ml-4 list-[lower-alpha] text-muted-foreground">
                  {q.options.map((o, j) => (
                    <li key={j} className={showQuizAnswers && j === q.answerIndex ? "font-medium text-foreground" : ""}>
                      {o}
                      {showQuizAnswers && j === q.answerIndex ? " (answer)" : ""}
                    </li>
                  ))}
                </ul>
              )}
              {showQuizAnswers && q.type === "true_false" && <p className="mt-1 text-muted-foreground">Answer: {q.answer ? "True" : "False"}</p>}
              {showQuizAnswers && q.type === "short" && <p className="mt-1 text-muted-foreground">Model answer: {q.modelAnswer}</p>}
            </li>
          ))}
        </ol>
      );
    }
  }
}
