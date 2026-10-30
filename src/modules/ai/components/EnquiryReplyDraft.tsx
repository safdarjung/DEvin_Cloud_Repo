"use client";

// Admissions "Draft a reply" (06 §W6-style AI draft, far simpler than
// QuizGenerateButton/QuizReviewEditor since there's no schema-object to
// review — just one editable string). Generates via `POST
// /api/ai/enquiry-reply`, then "Save as note" calls the existing
// `addEnquiryNote` action — same action EnquiryDetail's own note form
// uses, so this cannot write anything that action doesn't already allow.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addEnquiryNote } from "@/modules/admissions/actions";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";

interface EnquiryReplyErrorBody {
  ok: false;
  error: { code: string; message: string };
}

interface EnquiryReplySuccessBody {
  ok: true;
  data: { reply: string; provider: "local" | "cloud"; model: string; fallback: boolean };
}

// Same "policy name appended" convention as QuizGenerateButton's
// `errorMessage` (06 §W6 "Failure / retry").
function errorMessage(body: EnquiryReplyErrorBody, aiPolicy: string): string {
  switch (body.error.code) {
    case "ai_unavailable":
      return "Local AI engine is offline; retry or write the note manually";
    case "ai_invalid_output":
      return "Could not produce a valid draft; try again";
    case "ai_policy_blocked":
    case "quota_exceeded":
    case "rate_limited":
      return `${body.error.message} (policy: ${aiPolicy})`;
    default:
      return body.error.message;
  }
}

interface EnquiryReplyDraftProps {
  institutionSlug: string;
  enquiryId: string;
  aiPolicy: string;
}

export function EnquiryReplyDraft({ institutionSlug, enquiryId, aiPolicy }: EnquiryReplyDraftProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<EnquiryReplySuccessBody["data"] | null>(null);
  const [text, setText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/enquiry-reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ institutionSlug, enquiryId }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(errorMessage(body as EnquiryReplyErrorBody, aiPolicy));
        return;
      }
      const data = (body as EnquiryReplySuccessBody).data;
      setDraft(data);
      setText(data.reply);
    } catch {
      setError("Could not reach the server; check your connection and try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await addEnquiryNote(institutionSlug, { enquiryId, text });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setDraft(null);
      setText("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <div className="space-y-2">
        <Button type="button" variant="outline" size="sm" disabled={generating} onClick={handleGenerate}>
          {generating ? "Drafting…" : "Draft a reply"}
        </Button>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">AI draft — edit before saving</span>
        <ProviderBadge provider={draft.provider} />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        rows={3}
        className="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={saving || !text.trim()} onClick={handleSave}>
          {saving ? "Saving…" : "Save as note"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={saving}
          onClick={() => {
            setDraft(null);
            setText("");
            setError(null);
          }}
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
