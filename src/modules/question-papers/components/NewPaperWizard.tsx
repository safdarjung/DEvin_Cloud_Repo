"use client";

// Phase 3 wizard: 1 academic info, 2 source, 3 configuration, 4 generate. The editor is the fifth step.
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PairMeta } from "@/modules/question-bank/components/question-meta";
import { DIFFICULTIES, TYPES, pairKey } from "@/modules/question-bank/components/question-meta";
import type { QuestionType } from "@/modules/question-bank/schemas";
import { createPaper, generatePaperFromTemplate, saveTemplate, type GenerationGap } from "@/modules/question-papers/actions";
import type { PaperTemplate } from "@/modules/question-papers/queries";
import type { Blueprint } from "@/modules/question-papers/schemas";
import { GapFill } from "./GapFill";
import { SELECT_CLASS, fmtMarks, parseChapters, run } from "./paper-ui";

interface Row { type: QuestionType; count: string; marks: string; difficulty: string }
interface Sec { title: string; chooseCount: string; rows: Row[] }

const STEPS = ["Class and exam", "Source", "Blueprint", "Generate"] as const;
const EXAM_TYPES = ["Unit test", "Mid-term", "Final exam", "Half-yearly", "Practice paper"];
const DEFAULT_SECTIONS: Sec[] = [
  { title: "Section A", chooseCount: "", rows: [{ type: "mcq", count: "5", marks: "1", difficulty: "" }] },
  { title: "Section B", chooseCount: "", rows: [{ type: "short_answer", count: "3", marks: "2", difficulty: "" }] },
  { title: "Section C", chooseCount: "", rows: [{ type: "long_answer", count: "2", marks: "5", difficulty: "" }] },
];

const fromBlueprint = (bp: Blueprint): Sec[] =>
  bp.sections.map((s) => ({
    title: s.title,
    chooseCount: s.chooseCount ? String(s.chooseCount) : "",
    rows: s.rows.map((r) => ({ type: r.type, count: String(r.count), marks: String(r.marks), difficulty: r.difficulty ?? "" })),
  }));

const secTotal = (s: Sec) => s.rows.reduce((t, r) => t + (Number(r.count) || 0) * (Number(r.marks) || 0), 0);

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function NewPaperWizard({
  institutionSlug,
  pairs,
  years,
  sections: classSections,
  exams,
  templates,
}: {
  institutionSlug: string;
  pairs: PairMeta[];
  years: { id: string; label: string }[];
  sections: { id: string; label: string; gradeId: string }[];
  exams: { id: string; name: string }[];
  templates: PaperTemplate[];
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  // 1
  const [pairIdx, setPairIdx] = useState(0);
  const [yearId, setYearId] = useState(years[0]?.id ?? "");
  const [sectionId, setSectionId] = useState("");
  const [examType, setExamType] = useState("Unit test");
  const [examId, setExamId] = useState("");
  const [examDate, setExamDate] = useState("");
  // 2
  const [bookId, setBookId] = useState("");
  const [chapters, setChapters] = useState("");
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  // 3
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [secs, setSecs] = useState<Sec[]>(DEFAULT_SECTIONS);
  const [totalText, setTotalText] = useState("");
  const [passText, setPassText] = useState("");
  const [duration, setDuration] = useState("60");
  const [negative, setNegative] = useState("0");
  const [instructions, setInstructions] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [saveAs, setSaveAs] = useState("");
  // 4
  const [created, setCreated] = useState<{ id: string; added: number; gaps: GenerationGap[] } | null>(null);

  const pair = pairs[pairIdx];
  const computed = secs.reduce((t, s) => t + secTotal(s), 0);
  const total = totalText === "" ? computed : Number(totalText);
  const pairTemplates = useMemo(() => templates.filter((t) => (!t.gradeId || t.gradeId === pair.gradeId) && (!t.subjectId || t.subjectId === pair.subjectId)), [templates, pair]);
  const gradeSections = classSections.filter((s) => s.gradeId === pair.gradeId);

  const patchSec = (i: number, patch: Partial<Sec>) => setSecs((all) => all.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const patchRow = (i: number, j: number, patch: Partial<Row>) => setSecs((all) => all.map((s, k) => (k === i ? { ...s, rows: s.rows.map((r, m) => (m === j ? { ...r, ...patch } : r)) } : s)));

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSecs(fromBlueprint(t.blueprint));
    if (t.durationMinutes) setDuration(String(t.durationMinutes));
    if (t.instructions) setInstructions(t.instructions);
    if (t.examType) setExamType(t.examType);
  }

  const blueprint = (): Blueprint => {
    const w = Object.entries(weights).filter(([, v]) => v !== "").map(([curriculumUnitId, v]) => ({ curriculumUnitId, percent: Number(v) }));
    return {
      sections: secs.map((s) => ({
        title: s.title.trim(),
        ...(s.chooseCount ? { chooseCount: Number(s.chooseCount) } : {}),
        rows: s.rows.map((r) => ({ type: r.type, count: Number(r.count), marks: Number(r.marks), ...(r.difficulty ? { difficulty: r.difficulty as (typeof DIFFICULTIES)[number] } : {}) })),
      })),
      ...(w.length ? { chapterWeights: w } : {}),
    };
  };

  const stepError = (): string | null => {
    if (step === 0 && !yearId) return "Choose an academic year.";
    if (step === 2) {
      if (!title.trim()) return "Give the paper a title.";
      if (secs.some((s) => !s.title.trim() || s.rows.length === 0 || s.rows.some((r) => !(Number(r.count) >= 1) || !(Number(r.marks) > 0)))) return "Every section needs a title and rows with a count and marks.";
      if (!(total > 0)) return "Total marks must be above zero.";
      if (Number(passText || 0) > total) return "Pass marks cannot exceed total marks.";
    }
    return null;
  };

  async function create() {
    const err = stepError();
    if (err) return toast.error(err);
    setBusy(true);
    const bp = blueprint();
    const made = await run(
      createPaper(institutionSlug, {
        academicYearId: yearId,
        gradeId: pair.gradeId,
        subjectId: pair.subjectId,
        sectionId: sectionId || null,
        examId: examId || null,
        examType: examType || null,
        examDate: examDate || null,
        title: title.trim(),
        totalMarks: total,
        passMarks: Number(passText || 0),
        durationMinutes: Number(duration) || null,
        negativeMarking: Number(negative || 0),
        instructions: instructions.trim() || null,
        blueprint: bp,
      }),
    );
    if (!made) return setBusy(false);
    if (saveAs.trim()) {
      const saved = await run(saveTemplate(institutionSlug, { name: saveAs.trim(), gradeId: pair.gradeId, subjectId: pair.subjectId, examType: examType || null, durationMinutes: Number(duration) || null, instructions: instructions.trim() || null, blueprint: bp }));
      if (saved) toast.success("Template saved.");
    }
    const gen = await run(generatePaperFromTemplate(institutionSlug, { id: made.id }));
    setBusy(false);
    setCreated({ id: made.id, added: gen?.addedItemIds.length ?? 0, gaps: gen?.gaps ?? [] });
    setStep(3);
  }

  const query = () => {
    const sp = new URLSearchParams();
    if (bookId) sp.set("book", bookId);
    if (chapters.trim()) sp.set("chapters", chapters.trim());
    if (unitIds[0]) sp.set("unit", unitIds[0]);
    if (topicIds.length) sp.set("topics", topicIds.join(","));
    const q = sp.toString();
    return q ? `?${q}` : "";
  };
  const editorHref = created ? `/${institutionSlug}/question-papers/${created.id}${query()}` : "#";
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={`rounded-full border px-3 py-1 ${i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-muted" : "text-muted-foreground"}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Class and subject">
                <select aria-label="Class and subject" className={SELECT_CLASS} value={pairIdx} onChange={(e) => { setPairIdx(Number(e.target.value)); setSectionId(""); setUnitIds([]); setTopicIds([]); setBookId(""); }}>
                  {pairs.map((p, i) => <option key={pairKey(p.gradeId, p.subjectId)} value={i}>{p.gradeCode} {p.subjectName}</option>)}
                </select>
              </Field>
              <Field label="Academic year">
                <select aria-label="Academic year" className={SELECT_CLASS} value={yearId} onChange={(e) => setYearId(e.target.value)}>
                  {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
                </select>
              </Field>
              <Field label="Section (optional)">
                <select aria-label="Section" className={SELECT_CLASS} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                  <option value="">Whole grade</option>
                  {gradeSections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Exam type">
                <Input aria-label="Exam type" list="exam-types" value={examType} onChange={(e) => setExamType(e.target.value)} />
                <datalist id="exam-types">{EXAM_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
              </Field>
              <Field label="Linked exam (optional)" hint="Links the approved paper to offline marks entry.">
                <select aria-label="Linked exam" className={SELECT_CLASS} value={examId} onChange={(e) => setExamId(e.target.value)}>
                  <option value="">None</option>
                  {exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
              <Field label="Exam date (optional)">
                <Input type="date" aria-label="Exam date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Optional. Used to ground AI gap filling and to narrow the question picker; questions already in your bank are used either way.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Textbook">
                  <select aria-label="Textbook" className={SELECT_CLASS} value={bookId} onChange={(e) => setBookId(e.target.value)}>
                    <option value="">Any</option>
                    {pair.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
                  </select>
                </Field>
                <Field label="Chapters" hint="For example 1, 3-5">
                  <Input aria-label="Chapters" value={chapters} onChange={(e) => setChapters(e.target.value)} placeholder="1, 3-5" />
                </Field>
              </div>
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">Curriculum units</legend>
                <div className="flex flex-wrap gap-2">
                  {pair.units.length === 0 && <p className="text-sm text-muted-foreground">No units set up for this class.</p>}
                  {pair.units.map((u) => (
                    <label key={u.id} className="flex min-h-9 items-center gap-1.5 rounded-md border px-2 text-sm">
                      <input type="checkbox" checked={unitIds.includes(u.id)} onChange={() => toggle(unitIds, setUnitIds, u.id)} /> {u.title}
                    </label>
                  ))}
                </div>
              </fieldset>
              {pair.topics.length > 0 && (
                <fieldset className="space-y-1">
                  <legend className="text-sm font-medium">Topics</legend>
                  <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                    {pair.topics.filter((t) => unitIds.length === 0 || unitIds.includes(t.unitId)).map((t) => (
                      <label key={t.id} className="flex min-h-9 items-center gap-1.5 rounded-md border px-2 text-sm">
                        <input type="checkbox" checked={topicIds.includes(t.id)} onChange={() => toggle(topicIds, setTopicIds, t.id)} /> {t.title}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {pairTemplates.length > 0 && (
                <Field label="Start from a saved template">
                  <select aria-label="Template" className={SELECT_CLASS} value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
                    <option value="">Blank blueprint</option>
                    {pairTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Title">
                <Input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Unit test 1 — Fractions" />
              </Field>
              <div className="space-y-3">
                {secs.map((s, i) => (
                  <div key={i} className="space-y-2 rounded-lg border p-3" data-testid="bp-section">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-40 flex-1 space-y-1"><Label>Section title</Label><Input aria-label={`Section ${i + 1} title`} value={s.title} onChange={(e) => patchSec(i, { title: e.target.value })} /></div>
                      <div className="w-28 space-y-1"><Label>Attempt any</Label><Input aria-label={`Section ${i + 1} attempt any`} inputMode="numeric" placeholder="all" value={s.chooseCount} onChange={(e) => patchSec(i, { chooseCount: e.target.value.replace(/\D/g, "") })} /></div>
                      <p className="pb-2 text-sm text-muted-foreground">{fmtMarks(secTotal(s))} marks</p>
                      <Button type="button" variant="ghost" size="sm" disabled={secs.length === 1} onClick={() => setSecs(secs.filter((_, k) => k !== i))}>Remove section</Button>
                    </div>
                    {s.rows.map((r, j) => (
                      <div key={j} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_5rem_5rem_7rem_auto]">
                        <select aria-label={`Section ${i + 1} row ${j + 1} type`} className={`${SELECT_CLASS} col-span-2 sm:col-span-1`} value={r.type} onChange={(e) => patchRow(i, j, { type: e.target.value as QuestionType })}>
                          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        <Input aria-label={`Section ${i + 1} row ${j + 1} count`} inputMode="numeric" value={r.count} onChange={(e) => patchRow(i, j, { count: e.target.value.replace(/\D/g, "") })} />
                        <Input aria-label={`Section ${i + 1} row ${j + 1} marks each`} inputMode="decimal" value={r.marks} onChange={(e) => patchRow(i, j, { marks: e.target.value.replace(/[^\d.]/g, "") })} />
                        <select aria-label={`Section ${i + 1} row ${j + 1} difficulty`} className={SELECT_CLASS} value={r.difficulty} onChange={(e) => patchRow(i, j, { difficulty: e.target.value })}>
                          <option value="">Any level</option>
                          {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <Button type="button" variant="ghost" size="sm" disabled={s.rows.length === 1} onClick={() => patchSec(i, { rows: s.rows.filter((_, m) => m !== j) })}>Remove</Button>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">Each row: question type, how many, marks each, difficulty.</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => patchSec(i, { rows: [...s.rows, { type: "short_answer", count: "1", marks: "2", difficulty: "" }] })}>Add row</Button>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={() => setSecs([...secs, { title: `Section ${String.fromCharCode(65 + secs.length)}`, chooseCount: "", rows: [{ type: "short_answer", count: "1", marks: "2", difficulty: "" }] }])}>Add section</Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Total marks" hint={`Blueprint adds up to ${fmtMarks(computed)}.`}>
                  <Input aria-label="Total marks" inputMode="decimal" value={totalText === "" ? String(computed) : totalText} onChange={(e) => setTotalText(e.target.value.replace(/[^\d.]/g, ""))} />
                </Field>
                <Field label="Pass marks"><Input aria-label="Pass marks" inputMode="decimal" value={passText} onChange={(e) => setPassText(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></Field>
                <Field label="Duration (minutes)"><Input aria-label="Duration" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))} /></Field>
                <Field label="Negative marking"><Input aria-label="Negative marking" inputMode="decimal" value={negative} onChange={(e) => setNegative(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
              </div>
              {pair.units.length > 0 && (
                <fieldset className="space-y-1">
                  <legend className="text-sm font-medium">Chapter weights (percent, optional)</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {pair.units.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 text-sm">
                        <Input className="w-20" inputMode="decimal" aria-label={`Weight for ${u.title}`} value={weights[u.id] ?? ""} onChange={(e) => setWeights({ ...weights, [u.id]: e.target.value.replace(/[^\d.]/g, "") })} /> {u.title}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <Field label="General instructions (optional)"><Textarea aria-label="Instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} /></Field>
              <Field label="Save blueprint as template (optional)"><Input aria-label="Template name" value={saveAs} onChange={(e) => setSaveAs(e.target.value)} placeholder="Template name" /></Field>
            </div>
          )}

          {step === 3 && !created && (
            <div className="space-y-2">
              <p className="text-sm">Creating the paper fills it from your <strong>approved</strong> bank questions. Anything the bank cannot supply is listed so you can fill it with AI drafts or add it by hand.</p>
              <p className="text-sm text-muted-foreground">{title || "Untitled"} · {pair.gradeCode} {pair.subjectName} · {fmtMarks(total)} marks</p>
              <Button onClick={create} disabled={busy}>{busy ? "Building…" : "Create and fill paper"}</Button>
            </div>
          )}

          {step === 3 && created && (
            <div className="space-y-3" data-testid="wizard-result">
              <p className="text-sm">Paper created with {created.added} question{created.added === 1 ? "" : "s"} from your bank.{created.gaps.length === 0 ? " Every blueprint slot is filled." : ` ${created.gaps.reduce((t, g) => t + g.missing, 0)} slot(s) still need questions.`}</p>
              {created.gaps.length > 0 && (
                <GapFill
                  institutionSlug={institutionSlug}
                  paper={{ id: created.id, gradeId: pair.gradeId, subjectId: pair.subjectId }}
                  gaps={created.gaps}
                  source={{ bookId: bookId || undefined, chapterNos: parseChapters(chapters), unitId: unitIds[0], topicIds: topicIds.length ? topicIds : undefined }}
                  onDone={(left) => setCreated((c) => (c ? { ...c, gaps: left } : c))}
                />
              )}
              <Button asChild><Link href={editorHref}>Open the editor</Link></Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!(step === 3 && created) && (
        <div className="flex justify-between gap-2">
          <Button variant="outline" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>Back</Button>
          {step < 3 && <Button onClick={() => { const e = stepError(); if (e) toast.error(e); else setStep(step + 1); }}>Next</Button>}
        </div>
      )}
    </div>
  );
}
