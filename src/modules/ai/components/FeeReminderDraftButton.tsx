"use client";

// features-18 §C #17 — per-row "Draft reminder" on /finance/defaulters.
// Calls /api/ai/fee-reminder-draft (persists nothing) and shows three
// copyable drafts. Sending stays with the page's existing reminder action.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AiDraftBadge } from "@/modules/ai/components/AiDraft";
import { postAiTask } from "@/modules/ai/components/ai-task-fetch";
import type { FeeReminderResponse } from "@/modules/ai/fee-reminder.schemas";

const FIELDS = [
  { key: "callScript", label: "Call script" },
  { key: "sms", label: "SMS" },
  { key: "whatsapp", label: "WhatsApp" },
] as const;

interface Props {
  institutionSlug: string;
  invoiceId: string;
  termId: string;
  studentName: string;
}

export function FeeReminderDraftButton({ institutionSlug, invoiceId, termId, studentName }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<FeeReminderResponse | null>(null);

  async function generate() {
    setOpen(true);
    if (draft) return;
    setBusy(true);
    setError(null);
    const result = await postAiTask<FeeReminderResponse>("/api/ai/fee-reminder-draft", { institutionSlug, invoiceId, termId });
    setBusy(false);
    if (result.ok) setDraft(result.data);
    else setError(result.message);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy; select the text and copy it.");
    }
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={generate} aria-label={`Draft a fee reminder for ${studentName}`}>
        Draft reminder
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fee reminder for {studentName}</DialogTitle>
            <DialogDescription>Copy and edit before you use it. Nothing is sent from here.</DialogDescription>
          </DialogHeader>
          {busy && <p className="text-sm text-muted-foreground">Drafting…</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {draft && (
            <div className="space-y-3">
              <AiDraftBadge provider={draft.provider} />
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{f.label}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => copy(draft[f.key])}>
                      Copy
                    </Button>
                  </div>
                  <Textarea
                    rows={f.key === "sms" ? 2 : 4}
                    value={draft[f.key]}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    aria-label={f.label}
                  />
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
