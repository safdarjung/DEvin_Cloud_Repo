"use client";

// "Build this page": the six starter templates (work with AI off) and, when
// AI is on for this school and role, a brief -> POST /api/ai/website-draft
// plus a "Refine" follow-up. Every result comes back as a draft the editor
// shows in its preview; nothing is saved here (rule 6).
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { postAiTask, type AiProviderMeta } from "@/modules/ai/components/ai-task-fetch";
import { WEBSITE_TONES } from "@/modules/ai/website-drafts";
import { parseBlocksSafely, type Block } from "@/modules/website/blocks";
import { PAGE_KIND_LABELS, WEBSITE_PAGE_KINDS, websiteTemplate, type WebsitePageKind } from "@/modules/website/templates";

const ANY_TONE = "any";

export interface PageDraft {
  blocks: Block[];
  source: "template" | "ai";
  provider: AiProviderMeta["provider"] | null;
}

interface PageBuilderPanelProps {
  institutionSlug: string;
  institutionName: string;
  aiOn: boolean;
  /** What "Refine" revises: the pending draft if there is one, else the editor's blocks. */
  refineTarget: Block[];
  onDraft: (draft: PageDraft) => void;
}

export function PageBuilderPanel({ institutionSlug, institutionName, aiOn, refineTarget, onDraft }: PageBuilderPanelProps) {
  const id = useId();
  const [kind, setKind] = useState<WebsitePageKind>("home");
  const [tone, setTone] = useState<string>(ANY_TONE);
  const [brief, setBrief] = useState("");
  const [refine, setRefine] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draftWithAi(text: string, currentBlocks?: Block[]) {
    setBusy(true);
    setError(null);
    const res = await postAiTask<{ blocks: Block[] } & AiProviderMeta>("/api/ai/website-draft", {
      institutionSlug,
      kind,
      brief: text,
      tone: tone === ANY_TONE ? undefined : tone,
      currentBlocks,
    });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    onDraft({ blocks: res.data.blocks, source: "ai", provider: res.data.provider });
  }

  const refineBlocks = parseBlocksSafely(refineTarget);

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-lg border border-dashed p-4">
      <h3 id={`${id}-title`} className="font-medium">
        Build this page
      </h3>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Start from a template. It opens as a draft beside the editor; nothing changes until you use it.</p>
        <div className="flex flex-wrap gap-2">
          {WEBSITE_PAGE_KINDS.map((k) => (
            <Button
              key={k}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onDraft({ blocks: websiteTemplate(k, institutionName), source: "template", provider: null })}
            >
              {PAGE_KIND_LABELS[k]}
            </Button>
          ))}
        </div>
      </div>

      {aiOn && (
        <div className="space-y-3 border-t pt-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={kind} onValueChange={(v) => setKind(v as WebsitePageKind)}>
              <SelectTrigger aria-label="Page kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEBSITE_PAGE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {PAGE_KIND_LABELS[k]} page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger aria-label="Tone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_TONE}>Any tone</SelectItem>
                {WEBSITE_TONES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label htmlFor={`${id}-brief`} className="block text-sm font-medium">
            Build with AI
          </label>
          <Textarea
            id={`${id}-brief`}
            maxLength={1000}
            className="min-h-20"
            placeholder="e.g. Admissions page for nursery to class V: how to apply, documents to bring, and an enquiry form"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
          <Button type="button" variant="outline" disabled={busy || !brief.trim()} onClick={() => draftWithAi(brief)}>
            {busy ? "Drafting…" : "Draft with AI"}
          </Button>

          <div className="space-y-2">
            <label htmlFor={`${id}-refine`} className="block text-sm font-medium">
              Refine
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={`${id}-refine`}
                className="min-w-56 flex-1"
                maxLength={1000}
                placeholder="e.g. Shorter, and add a section on school transport"
                value={refine}
                onChange={(e) => setRefine(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy || !refine.trim() || refineBlocks.length === 0}
                onClick={() => draftWithAi(refine, refineBlocks)}
              >
                Refine
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
