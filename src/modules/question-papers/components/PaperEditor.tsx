"use client";

// Phase 3 editor: a document-like paper with an autosaved header, a live
// validation panel, workflow buttons per permission, versions and print links.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions/result";
import {
  applyTemplate, approvePaper, archivePaper, duplicatePaper, generatePaperFromTemplate, newPaperRevision, publishPaper, returnPaperToDraft, submitPaperForReview, updatePaper,
  type GenerationGap,
} from "@/modules/question-papers/actions";
import type { PaperDetail, PaperTemplate, PaperValidation, PaperVersion } from "@/modules/question-papers/queries";
import { GapFill, type GapSource } from "./GapFill";
import { PaperSections } from "./PaperSections";
import { PAPER_STATUS_LABEL, PAPER_STATUS_VARIANT, SELECT_CLASS, fmtMarks, run } from "./paper-ui";

const AUTOSAVE_MS = 800;
const KINDS = [{ v: "paper", l: "Question paper" }, { v: "key", l: "Answer key" }, { v: "scheme", l: "Marking scheme" }] as const;

export function PaperEditor({ institutionSlug, paper, validation, versions, templates, canApprove, canPublish, source }: {
  institutionSlug: string;
  paper: PaperDetail;
  validation: PaperValidation | null;
  versions: PaperVersion[];
  templates: PaperTemplate[];
  canApprove: boolean;
  canPublish: boolean;
  source: GapSource;
}) {
  const router = useRouter();
  const editable = paper.status === "draft";
  const [busy, setBusy] = useState(false);
  const [gaps, setGaps] = useState<GenerationGap[]>([]);
  const [setLetter, setSetLetter] = useState("A");
  const [tplId, setTplId] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [h, setH] = useState({
    title: paper.title,
    examType: paper.examType ?? "",
    examDate: paper.examDate ?? "",
    duration: paper.durationMinutes ? String(paper.durationMinutes) : "",
    total: String(paper.totalMarks),
    pass: String(paper.passMarks),
    negative: String(paper.negativeMarking),
    instructions: paper.instructions ?? "",
  });
  const first = useRef(true);

  // Debounced autosave of header edits; skipped (with a visible hint) while a value is invalid.
  const headerError =
    !h.title.trim() ? "Title is required." : !(Number(h.total) > 0) ? "Total marks must be above zero." : Number(h.pass || 0) > Number(h.total) ? "Pass marks cannot exceed total marks." : null;
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!editable || headerError) return;
    const t = setTimeout(async () => {
      const r = await run(
        updatePaper(institutionSlug, {
          id: paper.id,
          title: h.title.trim(),
          examType: h.examType.trim() || null,
          examDate: h.examDate || null,
          durationMinutes: Number(h.duration) || null,
          totalMarks: Number(h.total),
          passMarks: Number(h.pass || 0),
          negativeMarking: Number(h.negative || 0),
          instructions: h.instructions.trim() || null,
        }),
      );
      setSaved(r ? "saved" : "error");
      if (r) router.refresh();
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on header edits only
  }, [h]);

  async function go(call: Promise<ActionResult<unknown>>, done: string, to?: (id: string) => string) {
    setBusy(true);
    const r = (await run(call)) as { id?: string } | null;
    setBusy(false);
    if (!r) return;
    toast.success(done);
    if (to && r.id) router.push(to(r.id));
    else router.refresh();
  }
  const id = paper.id;
  const base = `/${institutionSlug}/question-papers`;
  const blocked = !validation || !validation.ok;

  async function fillFromBlueprint() {
    setBusy(true);
    const r = await run(generatePaperFromTemplate(institutionSlug, { id }));
    setBusy(false);
    if (!r) return;
    setGaps(r.gaps);
    toast.success(`Added ${r.addedItemIds.length} question${r.addedItemIds.length === 1 ? "" : "s"}.`);
    router.refresh();
  }

  const set = (patch: Partial<typeof h>) => {
    setSaved("saving");
    setH((x) => ({ ...x, ...patch }));
  };
  const totalNow = validation?.computedTotal ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3" data-testid="status-bar">
        <Badge variant={PAPER_STATUS_VARIANT[paper.status]} data-testid="paper-status">{PAPER_STATUS_LABEL[paper.status]}</Badge>
        <span className="text-sm text-muted-foreground">Version {paper.currentVersion}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {paper.status === "draft" && <Button disabled={busy || blocked} title={blocked ? "Fix the problems listed below first." : undefined} onClick={() => go(submitPaperForReview(institutionSlug, { id }), "Sent for review.")}>Submit for review</Button>}
          {paper.status === "in_review" && canApprove && <Button disabled={busy || blocked} title={blocked ? "Fix the problems listed below first." : undefined} onClick={() => go(approvePaper(institutionSlug, { id, expectedUpdatedAt: paper.updatedAt }), "Paper approved.")}>Approve</Button>}
          {(paper.status === "in_review" || paper.status === "approved") && <Button variant="outline" disabled={busy} onClick={() => go(returnPaperToDraft(institutionSlug, { id, reason: "Returned for changes" }), "Returned to draft.")}>Return to draft</Button>}
          {paper.status === "approved" && canPublish && <Button disabled={busy} onClick={() => go(publishPaper(institutionSlug, { id }), "Paper published.")}>Publish</Button>}
          {paper.status === "published" && canPublish && <Button variant="outline" disabled={busy} onClick={() => go(archivePaper(institutionSlug, { id }), "Paper archived.")}>Archive</Button>}
          {(paper.status === "published" || paper.status === "approved") && <Button variant="outline" disabled={busy} onClick={() => go(newPaperRevision(institutionSlug, { id }), "Revision started.", (n) => `${base}/${n}`)}>New revision</Button>}
          <Button variant="outline" disabled={busy} onClick={() => go(duplicatePaper(institutionSlug, { id }), "Paper duplicated.", (n) => `${base}/${n}`)}>Duplicate</Button>
        </div>
        {paper.status === "in_review" && !canApprove && <p className="basis-full text-sm text-muted-foreground">Waiting for the exam controller or principal to approve.</p>}
        {!editable && <p className="basis-full text-sm text-muted-foreground">Only a draft can be edited. Return it to draft or start a revision to change it.</p>}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{paper.gradeCode} {paper.subjectName}{paper.examName ? ` · ${paper.examName}` : ""}</CardTitle>
          {editable && <p role="status" className="text-xs text-muted-foreground">{headerError ?? (saved === "saving" ? "Saving…" : saved === "saved" ? "All changes saved" : saved === "error" ? "Could not save" : "")}</p>}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Title</Label>
            <Input aria-label="Paper title" disabled={!editable} value={h.title} onChange={(e) => set({ title: e.target.value })} className="text-base font-semibold" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1"><Label>Exam type</Label><Input aria-label="Exam type" disabled={!editable} value={h.examType} onChange={(e) => set({ examType: e.target.value })} /></div>
            <div className="space-y-1"><Label>Date</Label><Input type="date" aria-label="Exam date" disabled={!editable} value={h.examDate} onChange={(e) => set({ examDate: e.target.value })} /></div>
            <div className="space-y-1"><Label>Duration (min)</Label><Input aria-label="Duration" inputMode="numeric" disabled={!editable} value={h.duration} onChange={(e) => set({ duration: e.target.value.replace(/\D/g, "") })} /></div>
            <div className="space-y-1"><Label>Negative marking</Label><Input aria-label="Negative marking" inputMode="decimal" disabled={!editable} value={h.negative} onChange={(e) => set({ negative: e.target.value.replace(/[^\d.]/g, "") })} /></div>
            <div className="space-y-1"><Label>Total marks</Label><Input aria-label="Total marks" inputMode="decimal" disabled={!editable} value={h.total} onChange={(e) => set({ total: e.target.value.replace(/[^\d.]/g, "") })} /></div>
            <div className="space-y-1"><Label>Pass marks</Label><Input aria-label="Pass marks" inputMode="decimal" disabled={!editable} value={h.pass} onChange={(e) => set({ pass: e.target.value.replace(/[^\d.]/g, "") })} /></div>
          </div>
          <div className="space-y-1">
            <Label>General instructions</Label>
            <Textarea aria-label="General instructions" rows={2} disabled={!editable} value={h.instructions} onChange={(e) => set({ instructions: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <ValidationPanel validation={validation} target={paper.totalMarks} />

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          {paper.blueprint && <Button variant="outline" disabled={busy} onClick={fillFromBlueprint}>Fill from blueprint</Button>}
          {templates.length > 0 && (
            <>
              <select aria-label="Template" className={`${SELECT_CLASS} max-w-56`} value={tplId} onChange={(e) => setTplId(e.target.value)}>
                <option value="">Apply a template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <Button variant="outline" disabled={busy || !tplId} onClick={() => go(applyTemplate(institutionSlug, { paperId: id, templateId: tplId }), "Template applied.")}>Apply</Button>
            </>
          )}
        </div>
      )}
      {editable && gaps.length > 0 && (
        <GapFill institutionSlug={institutionSlug} paper={{ id, gradeId: paper.gradeId, subjectId: paper.subjectId }} gaps={gaps} source={source} onDone={(left) => { setGaps(left); router.refresh(); }} />
      )}

      <PaperSections institutionSlug={institutionSlug} paper={paper} editable={editable} />
      <p className="text-right text-sm text-muted-foreground" data-testid="total-line">Paper total {fmtMarks(totalNow)} of {fmtMarks(paper.totalMarks)} marks</p>

      <Card>
        <CardHeader><CardTitle className="text-base">Print</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>Set</Label>
            <select aria-label="Paper set" className={`${SELECT_CLASS} w-24`} value={setLetter} onChange={(e) => setSetLetter(e.target.value)}>
              {["A", "B", "C", "D"].map((l) => <option key={l} value={l}>Set {l}</option>)}
            </select>
          </div>
          {KINDS.map((k) => (
            <Button key={k.v} asChild variant="outline">
              <a href={`${base}/print?paper=${id}&kind=${k.v}&set=${setLetter}`} target="_blank" rel="noopener noreferrer">{k.l}</a>
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Version history</CardTitle></CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No frozen versions yet. One is saved each time the paper is approved or published.</p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="versions">
              {versions.map((v) => (
                <li key={v.versionNo} className="flex justify-between gap-2">
                  <span>Version {v.versionNo}{v.reason ? ` · ${v.reason}` : ""}</span>
                  <time className="text-muted-foreground" dateTime={v.createdAt}>{new Date(v.createdAt).toLocaleString()}</time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ValidationPanel({ validation, target }: { validation: PaperValidation | null; target: number }) {
  if (!validation) return <p role="alert" className="rounded-lg border p-3 text-sm text-muted-foreground">Checks could not be run. Reload the page to try again.</p>;
  const match = Math.abs(validation.computedTotal - target) < 0.005;
  return (
    <div className={`rounded-lg border p-3 text-sm ${validation.ok ? "border-success/40" : "border-destructive/40"}`} role="status" data-testid="validation">
      <p className="font-medium">
        {validation.ok ? "Ready to submit" : `${validation.errors.length} problem${validation.errors.length === 1 ? "" : "s"} to fix`}
        <span className={`ml-2 font-normal ${match ? "text-muted-foreground" : "text-destructive"}`}>Questions add up to {fmtMarks(validation.computedTotal)} of {fmtMarks(target)} marks</span>
      </p>
      {validation.errors.length > 0 && <ul className="mt-1 list-disc pl-5 text-destructive">{validation.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {validation.warnings.length > 0 && <ul className="mt-1 list-disc pl-5 text-warning">{validation.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
    </div>
  );
}
