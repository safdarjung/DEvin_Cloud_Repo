"use client";

// Study plan: build one from a real upcoming exam paper (or a custom date) and
// the student's own units, weak topics pre-flagged; then tick items off.
// The server allocates the days (src/modules/study/planner.ts) around the
// student's timetable when the timetable module is on.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { saveStudyPlan, toggleStudyPlanItem } from "@/modules/study/actions";
import type { PlanItem } from "@/modules/study/planner";

const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
const fmtDay = (d: string) => dayFmt.format(new Date(`${d}T12:00:00+05:30`));
const KIND_LABEL: Record<PlanItem["kind"], string> = { learn: "Learn", review: "Review", practice: "Practice quiz" };
const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface PlanExamOption {
  id: string;
  label: string;
  date: string;
  subjectName: string;
}

export function PlanBuilder({ institutionSlug, today, exams, subjects, weakUnitIds, timetableOn, hasPlan }: {
  institutionSlug: string;
  today: string;
  exams: PlanExamOption[];
  subjects: { id: string; name: string; units: { id: string; title: string }[] }[];
  weakUnitIds: string[];
  timetableOn: boolean;
  hasPlan: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unitsOfSubject = (name: string) => subjects.find((s) => s.name === name)?.units.map((u) => u.id) ?? [];
  const [target, setTarget] = useState(exams[0]?.id ?? "custom");
  const [customDate, setCustomDate] = useState("");
  const [minutes, setMinutes] = useState(45);
  const [picked, setPicked] = useState<string[]>(() => (exams[0] ? unitsOfSubject(exams[0].subjectName) : weakUnitIds));
  const [weak, setWeak] = useState<string[]>(weakUnitIds);
  const exam = exams.find((e) => e.id === target);
  const targetDate = exam?.date ?? customDate;

  function chooseTarget(id: string) {
    setTarget(id);
    const e = exams.find((x) => x.id === id);
    if (e) setPicked(unitsOfSubject(e.subjectName));
  }

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  function save() {
    const topics = subjects.flatMap((s) =>
      s.units.filter((u) => picked.includes(u.id)).map((u) => ({ key: u.id, label: u.title, subjectId: s.id, unitId: u.id, weak: weak.includes(u.id) })),
    );
    start(async () => {
      const res = await saveStudyPlan(institutionSlug, {
        title: exam ? `Plan for ${exam.label}` : "My study plan",
        targetDate,
        minutesPerDay: minutes,
        topics,
        ...(exam ? { examLabel: exam.label } : {}),
      });
      if (!res.ok) {
        toast.error(describeActionError(res.error));
        return;
      }
      toast.success(`Plan saved: ${res.data.items} study sessions.`);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="plan-builder" className="space-y-4 rounded-xl border p-4">
      <h3 id="plan-builder" className="text-base font-semibold">
        {hasPlan ? "Make a new plan" : "Build a study plan"}
      </h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm sm:col-span-2">
          Study for
          <select className={selectClass} value={target} onChange={(e) => chooseTarget(e.target.value)}>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label} · {fmtDay(e.date)}
              </option>
            ))}
            <option value="custom">Custom date</option>
          </select>
        </label>
        <label className="text-sm">
          Minutes a day
          <select className={selectClass} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[20, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
        {target === "custom" && (
          <label className="text-sm">
            Date
            <input type="date" min={today} value={customDate} onChange={(e) => setCustomDate(e.target.value)} className={selectClass} />
          </label>
        )}
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Topics</legend>
        <p className="text-xs text-muted-foreground">Topics marked weak get about twice the time.{timetableOn ? " Days with a full timetable get your chosen minutes; lighter days get more." : ""}</p>
        {subjects
          .filter((s) => s.units.length)
          .map((s) => (
            <div key={s.id}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.name}</p>
              <ul className="grid gap-1 sm:grid-cols-2">
                {s.units.map((u) => (
                  <li key={u.id} className="flex min-h-10 items-center justify-between gap-2 rounded-md px-2 hover:bg-muted/60">
                    <label className="flex min-w-0 items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4" checked={picked.includes(u.id)} onChange={() => setPicked(toggle(picked, u.id))} />
                      <span className="truncate">{u.title}</span>
                    </label>
                    {picked.includes(u.id) && (
                      <button
                        type="button"
                        aria-pressed={weak.includes(u.id)}
                        onClick={() => setWeak(toggle(weak, u.id))}
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${weak.includes(u.id) ? "border-amber-500 bg-amber-500/15" : "text-muted-foreground"}`}
                      >
                        {weak.includes(u.id) ? "Weak" : "Mark weak"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </fieldset>
      <Button onClick={save} disabled={pending || !targetDate || targetDate <= today || picked.length === 0}>
        {pending ? "Planning…" : "Build my plan"}
      </Button>
    </section>
  );
}

export function PlanView({ institutionSlug, plan, today }: {
  institutionSlug: string;
  plan: { id: string; title: string; targetDate: string; minutesPerDay: number; items: PlanItem[] };
  today: string;
}) {
  const [items, setItems] = useState(plan.items);
  const [, start] = useTransition();
  const days = [...new Set(items.map((i) => i.day))].filter((d) => d >= today);
  const done = items.filter((i) => i.done).length;

  function toggle(index: number) {
    const next = !items[index]!.done;
    setItems(items.map((it, i) => (i === index ? { ...it, done: next } : it)));
    start(async () => {
      const res = await toggleStudyPlanItem(institutionSlug, { planId: plan.id, index, done: next });
      if (!res.ok) {
        setItems((cur) => cur.map((it, i) => (i === index ? { ...it, done: !next } : it)));
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <section aria-labelledby="plan-view" className="space-y-3">
      <div>
        <h3 id="plan-view" className="text-base font-semibold">
          {plan.title}
        </h3>
        <p className="text-sm text-muted-foreground tabular-nums">
          Until {fmtDay(plan.targetDate)} · {plan.minutesPerDay} min a day · {done}/{items.length} done
        </p>
      </div>
      {days.length === 0 && <p className="text-sm text-muted-foreground">This plan has no days left. Build a new one below.</p>}
      <ol className="space-y-2">
        {days.slice(0, 14).map((d) => (
          <li key={d} className={`rounded-lg border p-3 ${d === today ? "border-primary bg-primary/5" : ""}`}>
            <p className="mb-1 text-sm font-medium">
              {d === today ? "Today" : fmtDay(d)}
            </p>
            <ul className="space-y-1">
              {items.map((it, i) =>
                it.day !== d ? null : (
                  <li key={i} className="flex min-h-10 items-center justify-between gap-2">
                    <label className="flex min-w-0 items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4" checked={it.done} onChange={() => toggle(i)} />
                      <span className={`truncate ${it.done ? "text-muted-foreground line-through" : ""}`}>{it.label}</span>
                    </label>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge variant="secondary">{KIND_LABEL[it.kind]}</Badge>
                      <span className="text-xs tabular-nums text-muted-foreground">{it.minutes} min</span>
                      {it.unitId && (
                        <Link
                          href={`/${institutionSlug}/portal/study/studio?tab=create&unit=${it.unitId}`}
                          className="hidden text-xs underline underline-offset-4 sm:inline"
                        >
                          Make notes
                        </Link>
                      )}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </li>
        ))}
      </ol>
      {days.length > 14 && <p className="text-xs text-muted-foreground">Showing the next 14 days of {days.length}.</p>}
    </section>
  );
}
