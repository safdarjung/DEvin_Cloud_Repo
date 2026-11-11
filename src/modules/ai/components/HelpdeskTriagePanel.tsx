"use client";

// features-18 §C2 — "Suggest" for a helpdesk manager: POST /api/ai/helpdesk-triage.
// Category and priority are shown as text for the manager to apply by hand
// (TicketControls); similar past tickets are links; the draft reply fills the
// reply box through `onDraft`, and is sent only with the normal reply button.
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { humanize } from "@/lib/format";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";
import { postAiTask, type AiProviderMeta } from "@/modules/ai/components/ai-task-fetch";

interface Triage extends AiProviderMeta {
  category: string;
  priority: string;
  reply: string;
  similar: { id: string; subject: string; category: string; status: string }[];
}

export function HelpdeskTriagePanel({ institutionSlug, ticketId, onDraft }: { institutionSlug: string; ticketId: string; onDraft: (reply: string) => void }) {
  const [triage, setTriage] = useState<Triage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function suggest() {
    setBusy(true);
    setError(null);
    const res = await postAiTask<Triage>("/api/ai/helpdesk-triage", { institutionSlug, ticketId });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setTriage(res.data);
    onDraft(res.data.reply);
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={suggest}>
        {busy ? "Suggesting…" : triage ? "Suggest again" : "Suggest with AI"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {triage && (
        <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">AI suggestion — apply by hand, review the reply before sending</span>
            <ProviderBadge provider={triage.provider} />
          </div>
          <p>
            Suggested category: <strong>{humanize(triage.category)}</strong> · priority: <strong>{humanize(triage.priority)}</strong>
          </p>
          {triage.similar.length > 0 ? (
            <div>
              <p className="text-muted-foreground">Similar past tickets</p>
              <ul className="list-disc pl-5">
                {triage.similar.map((t) => (
                  <li key={t.id}>
                    <Link className="underline-offset-2 hover:underline" href={`/${institutionSlug}/helpdesk?ticket=${t.id}`}>
                      {t.subject}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">({humanize(t.status)})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground">No similar past tickets.</p>
          )}
          <p className="text-muted-foreground">The draft reply is in the reply box below.</p>
        </div>
      )}
    </div>
  );
}
