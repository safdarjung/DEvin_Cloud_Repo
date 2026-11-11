"use client";

// Study studio "Create": pick a source and a format, generate a draft through
// the AI route, then keep it (save) or discard it. Students keep drafts as
// they are; teachers can edit and choose sections to share with.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LimitedBadge } from "@/components/honesty";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeActionError } from "@/lib/action-error";
import type { ErrorCode } from "@/lib/actions/result";
import { saveStudyMaterial, saveTeacherStudyMaterial } from "@/modules/study/actions";
import { DIFFICULTIES, FORMAT_LABELS, QUIZ_LENGTHS, QUIZ_TYPES, STUDY_FORMATS, type Difficulty, type QuizType, type StudyFormat } from "@/modules/study/formats";
import { PASTE_MAX_CHARS, PASTE_MIN_CHARS } from "@/modules/study/schemas";
import { ContentEditor } from "./ContentEditor";
import { AiLabel, MaterialView } from "./MaterialView";

type SourceKind = "unit" | "paste" | "resource" | "lesson_plan" | "textbook";

interface Draft {
  format: StudyFormat;
  title: string;
  sourceKind: SourceKind;
  subjectId: string | null;
  unitId: string | null;
  resourceId: string | null;
  content: unknown;
}

export interface StudyCreateProps {
  audience: "student" | "teacher";
  institutionSlug: string;
  aiOn: boolean;
  subjects: { id: string; name: string; units: { id: string; title: string }[] }[];
  resources: { id: string; title: string; subjectName: string }[];
  lessonPlans?: { id: string; title: string; plannedOn: string }[];
  sections?: { id: string; label: string }[];
  initialUnitId?: string;
}

const QUIZ_TYPE_LABELS: Record<QuizType, string> = { mcq: "Multiple choice", true_false: "True / false", short: "Short answer" };
const SOURCE_LABELS: Record<SourceKind, string> = { unit: "Curriculum unit", paste: "Paste notes", resource: "Shared resource", lesson_plan: "Lesson plan", textbook: "Textbook chapter" };
const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Choice({ label, selected, onClick, disabled }: { label: string; selected: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none ${
        selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

export function StudyCreate({ audience, institutionSlug, aiOn, subjects, resources, lessonPlans = [], sections = [], initialUnitId }: StudyCreateProps) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const withUnits = subjects.filter((s) => s.units.length > 0);
  const initialSubject = withUnits.find((s) => s.units.some((u) => u.id === initialUnitId)) ?? withUnits[0];
  const [kind, setKind] = useState<SourceKind>(withUnits.length ? "unit" : "paste");
  const [subjectId, setSubjectId] = useState(initialSubject?.id ?? "");
  const [unitId, setUnitId] = useState(initialUnitId ?? initialSubject?.units[0]?.id ?? "");
  const [text, setText] = useState("");
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? "");
  const [lessonPlanId, setLessonPlanId] = useState(lessonPlans[0]?.id ?? "");
  const [format, setFormat] = useState<StudyFormat>("quick_summary");
  const [count, setCount] = useState<(typeof QUIZ_LENGTHS)[number]>(5);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [types, setTypes] = useState<QuizType[]>(["mcq", "true_false"]);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [shareTo, setShareTo] = useState<string[]>([]);

  const subject = withUnits.find((s) => s.id === subjectId);
  const sourceKinds: SourceKind[] = audience === "teacher" ? ["unit", "textbook", "lesson_plan", "resource", "paste"] : ["unit", "textbook", "resource", "paste"];

  function sourceBody() {
    if (kind === "unit") return { kind, unitId };
    if (kind === "resource") return { kind, resourceId };
    if (kind === "lesson_plan") return { kind, lessonPlanId };
    if (kind === "textbook") return { kind, unitId, ...(text.trim() ? { text } : {}) };
    return { kind, text, ...(subjectId && subjects.some((s) => s.id === subjectId) ? { subjectId } : {}) };
  }

  const sourceReady =
    ((kind === "unit" || kind === "textbook") && unitId) || (kind === "resource" && resourceId) || (kind === "lesson_plan" && lessonPlanId) || (kind === "paste" && text.trim().length >= PASTE_MIN_CHARS);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(audience === "teacher" ? "/api/ai/study-teacher-generate" : "/api/ai/study-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ institutionSlug, format, source: sourceBody(), ...(format === "quiz" ? { quiz: { count, difficulty, types } } : {}) }),
      });
      const body = (await res.json()) as
        | { ok: true; data: Draft }
        | { ok: false; error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> } };
      if (!body.ok) {
        toast.error(body.error.code.startsWith("ai_") ? `${body.error.message} Nothing was saved.` : describeActionError(body.error));
        return;
      }
      setDraft(body.data);
      setEditing(false);
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setGenerating(false);
    }
  }

  function save() {
    if (!draft) return;
    const fields = {
      format: draft.format,
      title: draft.title,
      sourceKind: draft.sourceKind,
      content: draft.content,
      ...(draft.subjectId ? { subjectId: draft.subjectId } : {}),
      ...(draft.unitId ? { unitId: draft.unitId } : {}),
      ...(draft.resourceId ? { resourceId: draft.resourceId } : {}),
    };
    startSave(async () => {
      const res = audience === "teacher" ? await saveTeacherStudyMaterial(institutionSlug, { ...fields, sectionIds: shareTo }) : await saveStudyMaterial(institutionSlug, fields);
      if (!res.ok) {
        toast.error(describeActionError(res.error));
        return;
      }
      if (audience === "teacher") {
        toast.success(`Shared with ${shareTo.length} ${shareTo.length === 1 ? "section" : "sections"}.`);
        setDraft(null);
        setShareTo([]);
        router.refresh();
        return;
      }
      const base = `/${institutionSlug}/portal/study/studio`;
      toast.success("Saved to your library.");
      router.push(draft.format === "flashcards" ? `${base}?tab=cards&deck=${res.data.id}` : draft.format === "quiz" ? `${base}?tab=quiz&quiz=${res.data.id}` : `${base}?tab=library&item=${res.data.id}`);
    });
  }

  if (!aiOn) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-8 text-center">
        <p className="font-medium">AI study help is switched off</p>
        <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">Your school has turned this feature off. Saved items, flashcards and plans still work.</p>
      </div>
    );
  }

  if (draft) {
    return (
      <section aria-labelledby="draft-title" className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <AiLabel />
          <p className="text-xs text-muted-foreground">Draft only. Check it against your textbook; AI can make mistakes.</p>
        </div>
        <label className="block">
          <span className="sr-only">Title</span>
          <input
            id="draft-title"
            value={draft.title}
            maxLength={160}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="w-full rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold outline-none hover:border-input focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="rounded-xl border bg-card p-4">
          {editing ? (
            <ContentEditor value={draft.content} onChange={(content) => setDraft({ ...draft, content })} />
          ) : (
            <MaterialView format={draft.format} content={draft.content} showQuizAnswers={audience === "teacher"} />
          )}
        </div>
        {audience === "teacher" && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Share with your sections</legend>
            {sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">You have no sections to share with yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sections.map((s) => (
                  <Choice
                    key={s.id}
                    label={s.label}
                    selected={shareTo.includes(s.id)}
                    onClick={() => setShareTo(shareTo.includes(s.id) ? shareTo.filter((x) => x !== s.id) : [...shareTo, s.id])}
                  />
                ))}
              </div>
            )}
          </fieldset>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={saving || !draft.title.trim() || (audience === "teacher" && shareTo.length === 0)}>
            {saving ? "Saving…" : audience === "teacher" ? (shareTo.length ? `Save and share with ${shareTo.length}` : "Pick a section to share") : draft.format === "quiz" ? "Save and take quiz" : draft.format === "flashcards" ? "Save and drill" : "Save to library"}
          </Button>
          {audience === "teacher" && (
            <Button variant="outline" onClick={() => setEditing(!editing)}>
              {editing ? "Preview" : "Edit"}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
            Discard
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">1. Start from</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {sourceKinds.map((k) => (
            <Choice key={k} label={SOURCE_LABELS[k]} selected={kind === k} onClick={() => setKind(k)} disabled={(k === "unit" || k === "textbook") && withUnits.length === 0} />
          ))}
          <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground" title="Not available yet">
            Upload PDF or photo <LimitedBadge />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The AI cannot read uploaded PDFs or photos yet. You can keep your files on the Subjects page; to use their content here, paste the text.
        </p>

        {kind === "textbook" && (
          <p role="note" className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Uses the textbook chapter your teacher linked to the unit below. The AI has not read the book or its PDF: it works from the unit outline and anything you paste here. Open the chapter from your Subjects page.
          </p>
        )}
        {(kind === "unit" || kind === "textbook") && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Subject
              <select
                className={selectClass}
                value={subjectId}
                onChange={(e) => {
                  setSubjectId(e.target.value);
                  setUnitId(withUnits.find((s) => s.id === e.target.value)?.units[0]?.id ?? "");
                }}
              >
                {withUnits.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Unit
              <select className={selectClass} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {(subject?.units ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {kind === "resource" &&
          (resources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No resources have been shared with you yet.</p>
          ) : (
            <label className="block text-sm">
              Resource
              <select className={selectClass} value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} · {r.subjectName}
                  </option>
                ))}
              </select>
            </label>
          ))}
        {kind === "lesson_plan" &&
          (lessonPlans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lesson plans yet. Write one on the Lesson plans page, or paste your material.</p>
          ) : (
            <label className="block text-sm">
              Lesson plan
              <select className={selectClass} value={lessonPlanId} onChange={(e) => setLessonPlanId(e.target.value)}>
                {lessonPlans.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title} · {l.plannedOn}
                  </option>
                ))}
              </select>
            </label>
          ))}
        {kind === "textbook" && (
          <label className="block text-sm">
            Text from the chapter (optional)
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, PASTE_MAX_CHARS))}
              rows={4}
              placeholder="Paste a passage you want covered. Without it, the AI uses only the unit outline."
              className="mt-1 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        )}
        {kind === "paste" && (
          <label className="block text-sm">
            Your notes or material
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, PASTE_MAX_CHARS))}
              rows={7}
              placeholder="Paste notes, a textbook passage or your own summary."
              className="mt-1 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
              {text.length.toLocaleString("en-IN")} / {PASTE_MAX_CHARS.toLocaleString("en-IN")} characters{text.trim().length < PASTE_MIN_CHARS ? ` · at least ${PASTE_MIN_CHARS}` : ""}
            </span>
          </label>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">2. Make</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {STUDY_FORMATS.map((f) => (
            <Choice key={f} label={FORMAT_LABELS[f]} selected={format === f} onClick={() => setFormat(f)} />
          ))}
        </div>
        {format === "quiz" && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-sm text-muted-foreground">Questions</span>
              {QUIZ_LENGTHS.map((n) => (
                <Choice key={n} label={String(n)} selected={count === n} onClick={() => setCount(n)} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-sm text-muted-foreground">Difficulty</span>
              {DIFFICULTIES.map((d) => (
                <Choice key={d} label={d[0]!.toUpperCase() + d.slice(1)} selected={difficulty === d} onClick={() => setDifficulty(d)} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-sm text-muted-foreground">Types</span>
              {QUIZ_TYPES.map((t) => (
                <Choice
                  key={t}
                  label={QUIZ_TYPE_LABELS[t]}
                  selected={types.includes(t)}
                  onClick={() => setTypes(types.includes(t) ? (types.length > 1 ? types.filter((x) => x !== t) : types) : [...types, t])}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Short answers are checked by AI against a model answer. It is practice only and never a mark.</p>
          </div>
        )}
      </fieldset>

      <div aria-live="polite">
        {generating ? (
          <div className="space-y-2" role="status">
            <p className="text-sm text-muted-foreground">Writing your {FORMAT_LABELS[format].toLowerCase()}…</p>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <Button size="lg" onClick={generate} disabled={!sourceReady || (format === "quiz" && types.length === 0)} className="w-full sm:w-auto">
            Generate {FORMAT_LABELS[format].toLowerCase()}
          </Button>
        )}
      </div>
    </div>
  );
}
