"use client";

// A lesson plan from /lessonplan: the lesson as a timeline you can read at a glance, then each phase
// (what the teacher does, what the students do), board notes, exit questions with answers, help for
// those who struggle and a stretch, and the usual mistakes. Copy, Print, or Save it to the teacher's
// lesson plans through the approval card (the card checks the class and subject before anything is saved).
import { useState } from "react";
import { Check, ClipboardList, Copy, Printer, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import type { AiMeta, LessonPlanDoc } from "@/modules/ai/explain/schemas";

export type LessonPlanResult = { plan: LessonPlanDoc } & AiMeta;

const HUES = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#ca8a04"];

/** Start and end minute of each phase: "0–5". */
function spans(phases: LessonPlanDoc["phases"]): string[] {
  let at = 0;
  return phases.map((p) => {
    const from = at;
    at += p.minutes;
    return `${from}–${at}`;
  });
}

export function lessonPlanText(plan: LessonPlanDoc): string {
  const when = spans(plan.phases);
  return [
    plan.title,
    [plan.classLabel, plan.subject, `${plan.minutes} minutes`].filter(Boolean).join(" · "),
    "",
    "Objectives",
    ...plan.objectives.map((o) => `- ${o}`),
    plan.materials.length ? `\nMaterials: ${plan.materials.join(", ")}` : "",
    "",
    "Lesson",
    ...plan.phases.flatMap((p, i) => [`${when[i]} min  ${p.name}`, `  Teacher: ${p.teacher}`, p.students ? `  Students: ${p.students}` : ""]).filter(Boolean),
    plan.boardNotes.length ? "\nOn the board" : "",
    ...plan.boardNotes.map((n) => `- ${n}`),
    "",
    "Exit questions",
    ...plan.checks.map((c, i) => `${i + 1}. ${c.question}\n   Answer: ${c.answer}`),
    plan.support ? `\nSupport: ${plan.support}` : "",
    plan.stretch ? `Stretch: ${plan.stretch}` : "",
    plan.misconceptions.length ? "\nCommon mistakes" : "",
    ...plan.misconceptions.map((m) => `- ${m}`),
    plan.homework ? `\nHomework: ${plan.homework}` : "",
  ]
    .filter((l) => l !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function printPlan(plan: LessonPlanDoc) {
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  // Everything the model wrote is escaped: the print page renders text, never markup from the plan.
  const body = esc(lessonPlanText(plan))
    .split("\n")
    .map((l, i) => (i === 0 ? `<h1>${l}</h1>` : /^(Objectives|Lesson|On the board|Exit questions|Common mistakes)$/.test(l) ? `<h2>${l}</h2>` : `<p>${l || "&nbsp;"}</p>`))
    .join("");
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(plan.title)}</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#111}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 4px;border-bottom:1px solid #ddd}p{margin:2px 0;white-space:pre-wrap}</style></head><body>${body}</body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
}

export function LessonPlanCard({ result, onSave, saving }: { result: LessonPlanResult; onSave?: () => void; saving?: boolean }) {
  const { plan } = result;
  const [copied, setCopied] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const when = spans(plan.phases);

  return (
    <section aria-label={`Lesson plan: ${plan.title}`} className="space-y-4 overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <header className="space-y-2 border-b bg-gradient-to-br from-primary/10 via-transparent to-transparent p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <ClipboardList className="size-3.5" aria-hidden /> Lesson plan
          </p>
          <ProviderBadge provider={result.provider} />
        </div>
        <h3 className="text-lg font-semibold leading-snug">{plan.title}</h3>
        <div className="flex flex-wrap gap-1.5">
          {plan.classLabel && <Badge variant="secondary">{plan.classLabel}</Badge>}
          {plan.subject && <Badge variant="secondary">{plan.subject}</Badge>}
          <Badge variant="secondary">{plan.minutes} minutes</Badge>
        </div>
      </header>

      <div className="space-y-4 px-4">
        {/* The lesson at a glance: each phase's share of the period. */}
        <div>
          <div className="flex h-9 w-full overflow-hidden rounded-lg" role="img" aria-label={plan.phases.map((p) => `${p.name} ${p.minutes} minutes`).join(", ")}>
            {plan.phases.map((p, i) => (
              <div key={i} className="flex min-w-0 items-center justify-center px-1 text-[11px] font-medium text-white" style={{ flexGrow: p.minutes, flexBasis: 0, background: HUES[i % HUES.length] }} title={`${p.name}: ${p.minutes} min`}>
                <span className="truncate">{p.minutes}′</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold">Objectives</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm marker:text-muted-foreground">
            {plan.objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>

        <ol className="space-y-2">
          {plan.phases.map((p, i) => (
            <li key={i} className="grid grid-cols-[3.75rem_1fr] gap-3 rounded-xl border p-3">
              <div className="text-xs tabular-nums text-muted-foreground">
                <span className="mb-1 block h-1.5 w-8 rounded-full" style={{ background: HUES[i % HUES.length] }} aria-hidden />
                {when[i]} min
              </div>
              <div className="min-w-0 space-y-1 text-sm">
                <p className="font-semibold">{p.name}</p>
                <p>
                  <span className="text-muted-foreground">Teacher: </span>
                  {p.teacher}
                </p>
                {p.students && (
                  <p>
                    <span className="text-muted-foreground">Students: </span>
                    {p.students}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>

        {plan.boardNotes.length > 0 && (
          <div className="rounded-xl bg-[#1f3b2d] p-4 text-[#f1f5ef] shadow-inner">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide opacity-70">On the board</h4>
            <ul className="mt-1.5 space-y-1 font-mono text-[13px] leading-relaxed">
              {plan.boardNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Exit questions</h4>
            <button type="button" className="text-xs underline underline-offset-2" onClick={() => setShowAnswers((v) => !v)} aria-pressed={showAnswers}>
              {showAnswers ? "Hide answers" : "Show answers"}
            </button>
          </div>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
            {plan.checks.map((c) => (
              <li key={c.question}>
                {c.question}
                {showAnswers && <span className="block text-muted-foreground">{c.answer}</span>}
              </li>
            ))}
          </ol>
        </div>

        {(plan.support || plan.stretch) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {plan.support && (
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-sm">
                <p className="text-xs font-semibold text-sky-700 dark:text-sky-300">If they find it hard</p>
                <p className="mt-0.5">{plan.support}</p>
              </div>
            )}
            {plan.stretch && (
              <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 text-sm">
                <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">Stretch</p>
                <p className="mt-0.5">{plan.stretch}</p>
              </div>
            )}
          </div>
        )}

        {plan.misconceptions.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold">Common mistakes to watch for</h4>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm marker:text-muted-foreground">
              {plan.misconceptions.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-2 text-sm sm:grid-cols-2">
          {plan.materials.length > 0 && (
            <p>
              <span className="font-semibold">Bring: </span>
              {plan.materials.join(", ")}
            </p>
          )}
          {plan.homework && (
            <p>
              <span className="font-semibold">Homework: </span>
              {plan.homework}
            </p>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-3">
        {onSave && (
          <Button type="button" size="sm" disabled={saving} onClick={onSave}>
            <Save className="size-3.5" aria-hidden /> {saving ? "Opening…" : "Save to my lesson plans"}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(lessonPlanText(plan)).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />} {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => printPlan(plan)}>
          <Printer className="size-3.5" aria-hidden /> Print
        </Button>
        <p className="w-full text-[11px] text-muted-foreground">AI draft from the CBSE/NCERT syllabus. Check facts and experiments before you teach it.</p>
      </footer>
    </section>
  );
}
