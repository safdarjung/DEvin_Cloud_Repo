import { Lightbulb, Sparkles, TriangleAlert } from "lucide-react";
import type { NudgeKind } from "@/modules/ai/nudges";

// Colour never carries the kind alone: every use also renders the icon shape and the label.
export const KIND_META: Record<NudgeKind, { label: string; Icon: typeof Sparkles; glow: string; text: string }> = {
  alert: { label: "Needs you", Icon: TriangleAlert, glow: "#FCD34D", text: "text-amber-600 dark:text-amber-400" },
  suggestion: { label: "Suggestion", Icon: Lightbulb, glow: "#7DD3FC", text: "text-sky-600 dark:text-sky-400" },
  insight: { label: "Insight", Icon: Sparkles, glow: "#6EE7B7", text: "text-emerald-600 dark:text-emerald-400" },
};
