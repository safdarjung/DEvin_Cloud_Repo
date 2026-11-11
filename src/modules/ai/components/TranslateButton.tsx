"use client";

// features-18 §C2 — shared "Translate" control for text editors (helpdesk
// reply, diary note, form description). Calls POST /api/ai/translate and
// shows the result as an editable draft labelled "AI translation — review
// before sending"; nothing changes in the editor until "Use translation".
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import { postAiTask, type AiProviderMeta } from "@/modules/ai/components/ai-task-fetch";
import { LANGUAGE_NAMES, TRANSLATE_LANGUAGES, TRANSLATE_MAX_CHARS, type TranslateLanguage } from "@/modules/ai/task-drafts";

const SELECT_CLASS = "h-8 rounded-md border border-input bg-transparent px-2 text-sm";

interface TranslateButtonProps {
  institutionSlug: string;
  text: string;
  onUse: (translation: string) => void;
}

export function TranslateButton({ institutionSlug, text, onUse }: TranslateButtonProps) {
  const id = useId();
  const [language, setLanguage] = useState<TranslateLanguage>("hi");
  const [draft, setDraft] = useState<(AiProviderMeta & { translation: string }) | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooLong = text.length > TRANSLATE_MAX_CHARS;

  async function translate() {
    setBusy(true);
    setError(null);
    const res = await postAiTask<AiProviderMeta & { translation: string }>("/api/ai/translate", { institutionSlug, text, language });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setDraft(res.data);
    setValue(res.data.translation);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-lang`} className="sr-only">
          Translate into
        </label>
        <select id={`${id}-lang`} className={SELECT_CLASS} value={language} onChange={(e) => setLanguage(e.target.value as TranslateLanguage)}>
          {TRANSLATE_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {LANGUAGE_NAMES[l]}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm" disabled={busy || !text.trim() || tooLong} onClick={translate}>
          {busy ? "Translating…" : "Translate with AI"}
        </Button>
        {tooLong && <span className="text-xs text-muted-foreground">Up to {TRANSLATE_MAX_CHARS} characters can be translated.</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {draft && (
        <div className="space-y-2 rounded-md border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">AI translation — review before sending</span>
            <ProviderBadge provider={draft.provider} />
          </div>
          <Textarea aria-label="AI translation" rows={4} value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!value.trim()}
              onClick={() => {
                onUse(value);
                setDraft(null);
              }}
            >
              Use translation
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setDraft(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
