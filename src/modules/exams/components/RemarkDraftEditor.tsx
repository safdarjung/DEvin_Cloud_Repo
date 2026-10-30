"use client";

// T-0NN — "Draft a remark" (06 §W6-style flow, same shape as
// QuizGenerateButton + QuizReviewEditor combined into one field): generate
// -> editable textarea -> Save. Calls `/api/ai/report-remark` directly
// (that route persists nothing); saving goes through the real
// `saveResultRemark` action, which has its own validation and scope check.
// `{studentLabel}` is substituted with the real student name client-side —
// the model never sees it (src/modules/ai/prompts/remark.ts). Staff-editing
// view only (CLAUDE.md rule 7): never rendered on the guardian/student
// report card, which shows the saved remark plainly via ReportCard.tsx.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import { saveResultRemark } from "@/modules/exams/actions";

const STUDENT_LABEL_PLACEHOLDER = "{studentLabel}";
const MAX_REMARK_LENGTH = 500;

interface RemarkErrorBody {
  ok: false;
  error: { code: string; message: string };
}

function errorMessage(body: RemarkErrorBody, aiPolicy: string): string {
  switch (body.error.code) {
    case "ai_unavailable":
      return "Local AI engine is offline; retry or write the remark manually.";
    case "ai_invalid_output":
      return "Could not produce a valid remark draft; try again.";
    case "ai_policy_blocked":
    case "quota_exceeded":
    case "rate_limited":
      return `${body.error.message} (policy: ${aiPolicy})`;
    default:
      return body.error.message;
  }
}

interface RemarkDraftEditorProps {
  institutionSlug: string;
  resultId: string;
  studentName: string;
  initialRemark: string | null;
  aiPolicy: string;
}

export function RemarkDraftEditor({ institutionSlug, resultId, studentName, initialRemark, aiPolicy }: RemarkDraftEditorProps) {
  const [remark, setRemark] = useState(initialRemark ?? "");
  const [provider, setProvider] = useState<"local" | "cloud" | null>(null);
  const [model, setModel] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setSavedMessage(null);
    try {
      const res = await fetch("/api/ai/report-remark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ institutionSlug, resultId }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(errorMessage(body as RemarkErrorBody, aiPolicy));
        return;
      }
      // Fix round 1 (LOW-3, independent security review): substituting the
      // real name for `{studentLabel}` can push the text past the 500-char
      // save limit even though the model's own draft stayed under it —
      // truncate right here, before the text ever reaches state/the
      // textarea, not just at the `maxLength` attribute (which only caps
      // typed input, never a programmatic `setRemark`).
      const substituted = (body.data.remark as string).split(STUDENT_LABEL_PLACEHOLDER).join(studentName);
      setRemark(substituted.slice(0, MAX_REMARK_LENGTH));
      setProvider(body.data.provider);
      setModel(body.data.model);
    } catch {
      setError("Could not reach the server; check your connection and try again.");
    } finally {
      setGenerating(false);
    }
  }

  const remarkTooLong = remark.length > MAX_REMARK_LENGTH;

  async function handleSave() {
    if (remark.trim().length === 0 || remarkTooLong) return;
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const result = await saveResultRemark(institutionSlug, { resultId, remark: remark.trim() });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSavedMessage("Saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3 print:hidden">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Report-card remark</h3>
        {provider && <ProviderBadge provider={provider} />}
      </div>

      {provider && <p className="text-muted-foreground text-xs">AI draft — review before saving ({model})</p>}

      <Textarea
        value={remark}
        onChange={(e) => setRemark(e.target.value.slice(0, MAX_REMARK_LENGTH))}
        maxLength={MAX_REMARK_LENGTH}
        rows={3}
        placeholder="One-sentence remark for the report card…"
      />
      <p className="text-muted-foreground text-xs">
        {remark.length}/{MAX_REMARK_LENGTH}
      </p>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {savedMessage && <p className="text-sm text-muted-foreground">{savedMessage}</p>}

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={handleGenerate} disabled={generating}>
          {generating ? "Drafting…" : "Draft a remark"}
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving || remark.trim().length === 0 || remarkTooLong}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
