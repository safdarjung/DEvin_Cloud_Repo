"use client";

// DBT-160 — language picker; saves through `updateStudyLanguage`.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STUDENT_LANGUAGES } from "@/modules/ai/prompts/student-skills";
import { updateStudyLanguage } from "@/modules/ai/student-study.actions";

export function StudyLanguageForm({ institutionSlug, initialLanguage }: { institutionSlug: string; initialLanguage: string }) {
  const [language, setLanguage] = useState(initialLanguage);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSave() {
    setPending(true);
    setMessage(null);
    const result = await updateStudyLanguage(institutionSlug, { language });
    setPending(false);
    setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error.message });
  }

  return (
    <div className="max-w-sm space-y-3">
      <Label htmlFor="study-language">Study language</Label>
      <Select value={language} onValueChange={(v) => setLanguage(v ?? initialLanguage)}>
        <SelectTrigger id="study-language" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STUDENT_LANGUAGES.map((l) => (
            <SelectItem key={l.code} value={l.code}>
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" onClick={handleSave} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
