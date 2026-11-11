"use client";

// Study with AI: pick what to study from your own grade (subject -> the
// school's textbooks -> chapters -> units, plus files you may read) and a
// short goal. Only ids leave this page; the server re-checks every one and
// builds the tutor's context itself. NCERT books are links: the tutor has
// not read them and says so.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { giveFileReadingConsent } from "@/modules/study/help.actions";
import { openStudyScope } from "@/modules/study/scope.actions";

export interface PickerBook {
  id: string;
  subjectId: string;
  title: string;
  ncert: boolean;
  chapterCount: number;
  chapterTitles: Record<string, string>;
  summary: { studied: number; total: number; weakest: number | null };
}
export interface PickerUnit {
  id: string;
  subjectId: string;
  title: string;
  chapter: { textbookId: string; no: number } | null;
  minutes: number;
  accuracy: number | null;
}

const chip = (on: boolean) =>
  `min-h-10 rounded-lg border px-3 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted"}`;

export function ScopePicker({
  institutionSlug,
  subjects,
  books,
  units,
  files,
  consent,
  initialSubjectId,
}: {
  institutionSlug: string;
  subjects: { id: string; name: string }[];
  books: PickerBook[];
  units: PickerUnit[];
  files: { id: string; title: string; subjectId: string | null; readable: boolean }[];
  consent: boolean;
  initialSubjectId?: string;
}) {
  const router = useRouter();
  const [subjectIds, setSubjectIds] = useState<string[]>(initialSubjectId && subjects.some((s) => s.id === initialSubjectId) ? [initialSubjectId] : subjects[0] ? [subjects[0].id] : []);
  const [wholeBooks, setWholeBooks] = useState<string[]>([]);
  const [chapters, setChapters] = useState<string[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [goal, setGoal] = useState("");
  const [search, setSearch] = useState("");
  const [ticked, setTicked] = useState(false);
  const [pending, start] = useTransition();
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const shownUnits = useMemo(
    () => units.filter((u) => subjectIds.includes(u.subjectId) && (!search.trim() || u.title.toLowerCase().includes(search.trim().toLowerCase()))),
    [units, subjectIds, search],
  );
  const shownBooks = books.filter((b) => subjectIds.includes(b.subjectId));
  const shownFiles = files.filter((f) => f.subjectId === null || subjectIds.includes(f.subjectId));
  const picked = wholeBooks.length + chapters.length + unitIds.length + fileIds.length;

  function startSession() {
    start(async () => {
      if (fileIds.length && !consent) {
        const agreed = await giveFileReadingConsent(institutionSlug, { agree: true });
        if (!agreed.ok) {
          toast.error(describeActionError(agreed.error));
          return;
        }
      }
      const res = await openStudyScope(institutionSlug, {
        scope: {
          subjectIds,
          ...(wholeBooks.length ? { textbookIds: wholeBooks } : {}),
          ...(chapters.length ? { chapters: chapters.map((c) => ({ textbookId: c.split(":")[0]!, chapterNo: Number(c.split(":")[1]) })) } : {}),
          ...(unitIds.length ? { unitIds } : {}),
          ...(fileIds.length ? { fileIds } : {}),
          ...(goal.trim() ? { goal: goal.trim() } : {}),
        },
      });
      if (!res.ok) {
        toast.error(describeActionError(res.error));
        return;
      }
      router.push(`/${institutionSlug}/portal/study/scope/${res.data.id}`);
    });
  }

  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">1. Subjects</legend>
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) => (
            <button key={s.id} type="button" aria-pressed={subjectIds.includes(s.id)} className={chip(subjectIds.includes(s.id))} onClick={() => subjectIds.length > 1 || !subjectIds.includes(s.id) ? toggle(subjectIds, setSubjectIds, s.id) : undefined}>
              {s.name}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">2. Books and chapters</legend>
        {shownBooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Your school has not set a textbook for these subjects yet. Pick units below instead.</p>
        ) : (
          shownBooks.map((b) => (
            <div key={b.id} className="space-y-2 rounded-xl border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {b.title} {b.ncert && <Badge variant="outline">NCERT link · not read by the AI</Badge>}
                </p>
                <button type="button" aria-pressed={wholeBooks.includes(b.id)} className={chip(wholeBooks.includes(b.id))} onClick={() => toggle(wholeBooks, setWholeBooks, b.id)}>
                  Whole book
                </button>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {b.summary.studied} of {b.summary.total} chapters studied{b.summary.weakest ? `, weakest: Chapter ${b.summary.weakest}` : ""}
              </p>
              {!wholeBooks.includes(b.id) && (
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: b.chapterCount }, (_, i) => i + 1).map((n) => {
                    const key = `${b.id}:${n}`;
                    const unit = units.find((u) => u.chapter?.textbookId === b.id && u.chapter.no === n);
                    return (
                      <button key={key} type="button" aria-pressed={chapters.includes(key)} className={chip(chapters.includes(key))} onClick={() => toggle(chapters, setChapters, key)} title={unit ? `Unit: ${unit.title}` : undefined}>
                        Ch {n}
                        {b.chapterTitles[String(n)] ? ` · ${b.chapterTitles[String(n)]}` : unit ? ` · ${unit.title}` : ""}
                        {unit && (unit.minutes > 0 || unit.accuracy !== null) ? ` (${unit.accuracy ?? "–"}%)` : ""}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">3. Topics (curriculum units)</legend>
        <label className="block text-sm">
          <span className="sr-only">Search units</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search units"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {shownUnits.map((u) => (
            <button key={u.id} type="button" aria-pressed={unitIds.includes(u.id)} className={chip(unitIds.includes(u.id))} onClick={() => toggle(unitIds, setUnitIds, u.id)}>
              {u.title}
              <span className="ml-1 text-xs opacity-80 tabular-nums">
                {[u.minutes ? `${u.minutes} min` : null, u.accuracy !== null ? `${u.accuracy}%` : null].filter(Boolean).join(" · ") || "not studied yet"}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {shownFiles.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">4. Files the AI may read (optional, up to 3)</legend>
          <div className="flex flex-wrap gap-1.5">
            {shownFiles.map((f) => (
              <button key={f.id} type="button" disabled={!f.readable} aria-pressed={fileIds.includes(f.id)} className={chip(fileIds.includes(f.id))} onClick={() => (fileIds.length < 3 || fileIds.includes(f.id) ? toggle(fileIds, setFileIds, f.id) : undefined)}>
                {f.title}
                {!f.readable ? " · too big to read" : ""}
              </button>
            ))}
          </div>
          {fileIds.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">A picked file is sent to the school&apos;s AI provider to be read when the tutor needs it. It cannot be screened for names first.</p>
              {!consent && (
                <label className="flex min-h-11 items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 size-4" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
                  <span>I agree that my picked files are sent to the school&apos;s AI provider to be read.</span>
                </label>
              )}
            </>
          )}
        </fieldset>
      )}

      <label className="block text-sm font-semibold">
        What I want out of this <span className="font-normal text-muted-foreground">(optional)</span>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value.slice(0, 200))}
          placeholder="e.g. understand the proofs before Friday's test"
          className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <Button size="lg" onClick={startSession} disabled={pending || picked === 0 || subjectIds.length === 0 || (fileIds.length > 0 && !consent && !ticked)}>
        {pending ? "Opening…" : "Start studying with AI"}
      </Button>
    </div>
  );
}
