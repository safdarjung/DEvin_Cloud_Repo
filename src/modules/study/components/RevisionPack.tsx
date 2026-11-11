"use client";

// One click: short notes + a flashcard deck + a 10-question quiz on the
// weakest units (chosen on the server, weak-units.ts). Three drafts through
// the normal study generate route; nothing is kept until "Keep pack" (rule 6).
// Student: saved to their library as one pack (feeds the planner). Teacher:
// a section's weakest units (aggregate only), shared with that section.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeActionError } from "@/lib/action-error";
import { saveStudyMaterial, saveTeacherStudyMaterial } from "@/modules/study/actions";
import { FORMAT_LABELS } from "@/modules/study/formats";
import { AiLabel, MaterialView } from "./MaterialView";

type PackFormat = "revision_notes" | "flashcards" | "quiz";
const PACK: { format: PackFormat; quiz?: { count: 10; difficulty: "medium"; types: ("mcq" | "true_false" | "short")[] } }[] = [
  { format: "revision_notes" },
  { format: "flashcards" },
  { format: "quiz", quiz: { count: 10, difficulty: "medium", types: ["mcq", "true_false", "short"] } },
];

interface PackDraft {
  format: PackFormat;
  title: string;
  sourceKind: "revision_pack" | "class_pack";
  subjectId: string | null;
  unitId: string | null;
  focusUnitIds: string[];
  content: unknown;
}

export function RevisionPack({ audience, institutionSlug, sections = [] }: { audience: "student" | "teacher"; institutionSlug: string; sections?: { id: string; label: string }[] }) {
  const router = useRouter();
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<PackDraft[] | null>(null);
  const [saving, startSave] = useTransition();

  async function build() {
    const out: PackDraft[] = [];
    try {
      for (const item of PACK) {
        setBusy(FORMAT_LABELS[item.format]);
        const res = await fetch(audience === "teacher" ? "/api/ai/study-teacher-generate" : "/api/ai/study-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            institutionSlug,
            format: item.format,
            source: audience === "teacher" ? { kind: "class_weak_units", sectionId } : { kind: "weak_units" },
            ...(item.quiz ? { quiz: item.quiz } : {}),
          }),
        });
        const body = (await res.json()) as { ok: true; data: PackDraft } | { ok: false; error: { code: string; message: string } };
        if (!body.ok) {
          toast.error(`${body.error.message}${out.length ? " The pack was not finished; nothing was saved." : ""}`);
          return;
        }
        out.push(body.data);
      }
      setDrafts(out);
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  function keep() {
    if (!drafts) return;
    const bundleId = crypto.randomUUID();
    startSave(async () => {
      for (const d of drafts) {
        const fields = {
          format: d.format,
          title: d.title,
          sourceKind: d.sourceKind,
          content: d.content,
          bundleId,
          focusUnitIds: d.focusUnitIds,
          ...(d.subjectId ? { subjectId: d.subjectId } : {}),
          ...(d.unitId ? { unitId: d.unitId } : {}),
        };
        const res = audience === "teacher" ? await saveTeacherStudyMaterial(institutionSlug, { ...fields, sectionIds: [sectionId] }) : await saveStudyMaterial(institutionSlug, fields);
        if (!res.ok) {
          toast.error(describeActionError(res.error));
          return;
        }
      }
      toast.success(audience === "teacher" ? "Class revision pack shared with the section." : "Revision pack saved. Its topics now get extra time in your plan.");
      setDrafts(null);
      router.refresh();
    });
  }

  if (drafts) {
    return (
      <section aria-labelledby="pack-title" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="pack-title" className="text-base font-semibold">
            {audience === "teacher" ? "Class revision pack" : "Your revision pack"}
          </h3>
          <AiLabel />
        </div>
        <p className="text-xs text-muted-foreground">Draft only, made from the weakest units{audience === "teacher" ? " of this section (class totals only)" : " in your own practice"}. AI can make mistakes.</p>
        {drafts.map((d) => (
          <details key={d.format} className="rounded-xl border bg-card p-3" open={d.format === "revision_notes"}>
            <summary className="min-h-10 cursor-pointer text-sm font-medium">{d.title}</summary>
            <div className="mt-2">
              <MaterialView format={d.format} content={d.content} showQuizAnswers={audience === "teacher"} />
            </div>
          </details>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button onClick={keep} disabled={saving}>
            {saving ? "Saving…" : audience === "teacher" ? "Share pack with the section" : "Keep pack"}
          </Button>
          <Button variant="ghost" onClick={() => setDrafts(null)} disabled={saving}>
            Discard
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      {audience === "teacher" &&
        (sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no sections yet.</p>
        ) : (
          <label className="block text-sm">
            Section
            <select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      <div aria-live="polite">
        {busy ? (
          <div role="status" className="space-y-2">
            <p className="text-sm text-muted-foreground">Writing {busy.toLowerCase()}…</p>
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <Button onClick={build} disabled={audience === "teacher" && !sectionId}>
            {audience === "teacher" ? "Build class revision pack" : "Build my revision pack"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {audience === "teacher"
          ? "Picks the section's weakest units from class practice and mastery totals. No student names or scores go to the AI."
          : "Picks your weakest units from your practice, quizzes and mastery, recent answers counting most. Short notes, flashcards and a 10-question quiz."}
      </p>
    </div>
  );
}
