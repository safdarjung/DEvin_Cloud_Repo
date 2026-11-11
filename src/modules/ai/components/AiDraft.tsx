// features-18 §C — the visible "AI draft" label (CLAUDE.md rule 7) with the
// provider, shared by the lesson-plan, question-paper, fee-reminder and
// PTM-brief UIs.
import { Badge } from "@/components/ui/badge";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";

export function AiDraftBadge({ provider, text = "AI draft — review before use" }: { provider?: "local" | "cloud" | null; text?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">{text}</Badge>
      {provider && <ProviderBadge provider={provider} />}
    </span>
  );
}
