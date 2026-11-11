"use client";

// Language versions of a material (0140): links to the versions that exist,
// and "Make a Hindi / English version" through the translate route. The
// result is an AI translation draft; kept only with the save action.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Languages } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import type { MaterialFormat } from "@/modules/study/formats";
import { saveStudyVariant, saveTeacherStudyVariant } from "@/modules/study/help.actions";
import { LANGUAGE_LABELS, type VariantLanguage } from "@/modules/study/variants";
import { MaterialView } from "./MaterialView";

interface Draft {
  baseId: string;
  format: MaterialFormat;
  title: string;
  language: VariantLanguage;
  content: unknown;
}

export function LanguageVersions({
  audience,
  institutionSlug,
  current,
  versions,
  hrefFor,
  canTranslate,
}: {
  audience: "student" | "teacher";
  institutionSlug: string;
  current: { id: string; language: VariantLanguage };
  versions: { id: string; language: VariantLanguage }[];
  /** Base path; `${hrefFor}${id}` opens a version. */
  hrefFor: string;
  canTranslate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, start] = useTransition();
  const missing = (["en", "hi"] as const).find((l) => !versions.some((v) => v.language === l));

  async function translate(language: VariantLanguage) {
    setBusy(true);
    try {
      const res = await fetch(audience === "teacher" ? "/api/ai/study-teacher-translate" : "/api/ai/study-translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ institutionSlug, materialId: current.id, language }),
      });
      const body = (await res.json()) as { ok: true; data: Draft } | { ok: false; error: { message: string } };
      if (!body.ok) {
        toast.error(`${body.error.message} Nothing was saved.`);
        return;
      }
      setDraft(body.data);
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Language">
        <Languages className="size-4 text-muted-foreground" aria-hidden />
        {versions.map((v) =>
          v.id === current.id ? (
            <Badge key={v.id}>{LANGUAGE_LABELS[v.language]}</Badge>
          ) : (
            <Link key={v.id} href={`${hrefFor}${v.id}`} className="inline-flex min-h-9 items-center rounded-md border px-2.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
              {LANGUAGE_LABELS[v.language]}
            </Link>
          ),
        )}
        {canTranslate && missing && !draft && (
          <Button type="button" size="sm" variant="outline" onClick={() => translate(missing)} disabled={busy}>
            {busy ? "Translating…" : `Make ${LANGUAGE_LABELS[missing]} version`}
          </Button>
        )}
        {versions.some((v) => v.language === "hi") && <span className="text-xs text-muted-foreground">Hindi versions are AI translations.</span>}
      </div>
      {draft && (
        <section aria-label="Translation draft" className="space-y-3 rounded-xl border p-4">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {draft.title} <Badge variant="secondary">AI translation — check before use</Badge>
          </p>
          <MaterialView format={draft.format} content={draft.content} showQuizAnswers={audience === "teacher"} />
          <div className="flex gap-2">
            <Button
              disabled={saving}
              onClick={() =>
                start(async () => {
                  const input = { baseId: draft.baseId, title: draft.title, language: draft.language, content: draft.content };
                  const res = audience === "teacher" ? await saveTeacherStudyVariant(institutionSlug, input) : await saveStudyVariant(institutionSlug, input);
                  if (!res.ok) {
                    toast.error(describeActionError(res.error));
                    return;
                  }
                  toast.success("Translation saved.");
                  setDraft(null);
                  router.push(`${hrefFor}${res.data.id}`);
                })
              }
            >
              {saving ? "Saving…" : "Keep translation"}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
              Discard
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
