"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTest } from "@/modules/online-tests/actions";
import type { ReleasePolicy } from "@/modules/online-tests/schemas";
import { RELEASE_LABEL, SELECT_CLASS, run } from "./test-ui";

interface PaperOpt { id: string; title: string; gradeId: string; label: string; currentVersion: number }
interface SectionOpt { id: string; label: string; gradeId: string }

const localNow = (offsetMin: number) => {
  const d = new Date(Date.now() + offsetMin * 60_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TestCreateForm({ institutionSlug, papers, sections }: { institutionSlug: string; papers: PaperOpt[]; sections: SectionOpt[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [paperId, setPaperId] = useState(papers[0].id);
  const paper = papers.find((p) => p.id === paperId) ?? papers[0];
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState(`${papers[0].title} (online)`);
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [opensAt, setOpensAt] = useState(localNow(5));
  const [closesAt, setClosesAt] = useState(localNow(60 * 24));
  const [duration, setDuration] = useState("30");
  const [attempts, setAttempts] = useState("1");
  const [shuffle, setShuffle] = useState(false);
  const [practice, setPractice] = useState(false);
  const [showResults, setShowResults] = useState<ReleasePolicy>("after_publish");
  const [showAnswers, setShowAnswers] = useState<ReleasePolicy>("after_publish");
  const gradeSections = sections.filter((s) => s.gradeId === paper.gradeId);
  const releaseOptions: ReleasePolicy[] = practice ? ["never", "after_close", "after_publish"] : ["never", "after_publish"];

  const pick = (id: string) => {
    const p = papers.find((x) => x.id === id) ?? papers[0];
    setPaperId(id);
    setTitle(`${p.title} (online)`);
    setSectionIds([]);
    setVersion("");
  };
  const toggle = (id: string) => setSectionIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const data = await run(
      createTest(institutionSlug, {
        questionPaperId: paper.id,
        ...(version ? { paperVersionNo: Number(version) } : {}),
        title,
        sectionIds,
        opensAt: new Date(opensAt).toISOString(),
        closesAt: new Date(closesAt).toISOString(),
        durationMinutes: Number(duration),
        maxAttempts: Number(attempts),
        shuffle,
        practice,
        showResults: !practice && showResults === "after_close" ? "after_publish" : showResults,
        showAnswers: !practice && showAnswers === "after_close" ? "after_publish" : showAnswers,
      }),
    );
    setBusy(false);
    if (data) router.push(`/${institutionSlug}/online-tests/${data.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="test-create-form">
      <Field label="Question paper">
        <select aria-label="Question paper" className={SELECT_CLASS} value={paperId} onChange={(e) => pick(e.target.value)}>
          {papers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paper version" hint={`Leave empty for the current version (v${paper.currentVersion}).`}>
          <Input aria-label="Paper version" type="number" min={1} max={paper.currentVersion} value={version} onChange={(e) => setVersion(e.target.value)} />
        </Field>
        <Field label="Title">
          <Input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </Field>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Classes</legend>
        {gradeSections.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no class sections for this paper&apos;s grade.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {gradeSections.map((s) => (
              <label key={s.id} className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm">
                <input type="checkbox" checked={sectionIds.includes(s.id)} onChange={() => toggle(s.id)} aria-label={`Class ${s.label}`} />
                {s.label}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Opens at">
          <Input aria-label="Opens at" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} required />
        </Field>
        <Field label="Closes at">
          <Input aria-label="Closes at" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} required />
        </Field>
        <Field label="Duration (minutes)">
          <Input aria-label="Duration" type="number" min={1} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} required />
        </Field>
        <Field label="Attempts allowed">
          <Input aria-label="Attempts allowed" type="number" min={1} max={10} value={attempts} onChange={(e) => setAttempts(e.target.value)} required />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} /> Shuffle questions</label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={practice} onChange={(e) => { setPractice(e.target.checked); if (!e.target.checked) { setShowResults("after_publish"); setShowAnswers("after_publish"); } }} />
          Practice test (can show results when it closes)
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Show scores to students">
          <select aria-label="Show results" className={SELECT_CLASS} value={showResults} onChange={(e) => setShowResults(e.target.value as ReleasePolicy)}>
            {releaseOptions.map((v) => <option key={v} value={v}>{RELEASE_LABEL[v]}</option>)}
          </select>
        </Field>
        <Field label="Show correct answers">
          <select aria-label="Show answers" className={SELECT_CLASS} value={showAnswers} onChange={(e) => setShowAnswers(e.target.value as ReleasePolicy)}>
            {releaseOptions.map((v) => <option key={v} value={v}>{RELEASE_LABEL[v]}</option>)}
          </select>
        </Field>
      </div>
      <Button type="submit" disabled={busy || sectionIds.length === 0}>{busy ? "Creating..." : "Create test"}</Button>
    </form>
  );
}
