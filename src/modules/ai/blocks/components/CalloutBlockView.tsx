import { InfoIcon, LightbulbIcon, TriangleAlertIcon } from "lucide-react";
import type { CalloutBlock } from "@/modules/ai/blocks/schemas";

// Review finding (HIGH): tone must not be color-only — each tone also
// gets its own icon, not just a different border/background color.
const TONE_CLASSES: Record<CalloutBlock["tone"], string> = {
  info: "border-info/40 bg-info/10 text-foreground",
  tip: "border-success/40 bg-success/10 text-foreground",
  warning: "border-warning/40 bg-warning/10 text-foreground",
};

const TONE_ICONS: Record<CalloutBlock["tone"], typeof InfoIcon> = {
  info: InfoIcon,
  tip: LightbulbIcon,
  warning: TriangleAlertIcon,
};

export function CalloutBlockView({ block }: { block: CalloutBlock }) {
  const Icon = TONE_ICONS[block.tone];
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${TONE_CLASSES[block.tone]}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{block.text}</span>
    </div>
  );
}
