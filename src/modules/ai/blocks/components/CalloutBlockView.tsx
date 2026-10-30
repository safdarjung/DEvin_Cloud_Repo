import { InfoIcon, LightbulbIcon, TriangleAlertIcon } from "lucide-react";
import type { CalloutBlock } from "@/modules/ai/blocks/schemas";

// Review finding (HIGH): tone must not be color-only — each tone also
// gets its own icon, not just a different border/background color.
const TONE_CLASSES: Record<CalloutBlock["tone"], string> = {
  info: "border-blue-400 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100",
  tip: "border-emerald-400 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100",
  warning: "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
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
